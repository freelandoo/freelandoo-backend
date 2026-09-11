# Migração WhatsApp: Evolution (não-oficial) → Meta Cloud API oficial

**Data:** 2026-09-11
**Decisão do Alex:** Tech Provider direto na Meta — sem BSP, sem custo recorrente, aprovações feitas por ele.
**Motivo:** o risco de ban permanente do número dos usuários (Baileys/Evolution viola os ToS da Meta) e a exposição jurídica que isso cria.

---

## 0. A decisão de produto que precede o código

**Tech Provider obriga CADA cliente a cadastrar um método de pagamento próprio na Meta antes de enviar qualquer mensagem** — mesmo que o uso seja 100% gratuito (atendimento não é cobrado). Quem dispensa isso é o **Solution Partner**, que compartilha a própria linha de crédito; e Solution Partner não é self-serve ("a lengthy process", com contrato comercial).

Consequência no funil de conexão do Ricardo:

| Evolution (hoje) | Cloud API via Tech Provider |
|---|---|
| Aponta a câmera no QR | Ter o app **WhatsApp Business** (o verde) — o comum não serve |
| — | Ter conta Facebook/Meta Business |
| — | Passar pelo Embedded Signup |
| — | **Cadastrar cartão de crédito na Meta** |
| — | Conectar |

Isso não muda uma linha do plano abaixo — muda quantos vão até o fim. Decisão consciente do Alex: assume a fricção em troca de zero custo recorrente e de não depender de BSP.

**Mitigação possível (fora do escopo desta migração):** entrar depois em multi-partner solution com um Solution Partner, que permite herdar a linha de crédito sem perder a arquitetura. A modelagem abaixo não impede isso.

---

## 1. Mapa: o que se aproveita da mig 223

A arquitetura da mig 223 foi desenhada certo e **a maior parte sobrevive intacta**. A instância já é POR PESSOA, o roteamento já é por referência do provedor, e a ingestão já é isolada do envio.

### Sobrevive sem mudança

| Peça | Linhas | Por quê sobrevive |
|---|---|---|
| `tb_whatsapp_conversation` | — | `remote_jid`/`phone` acomodam o `wa_id` da Meta (só dígitos) |
| `tb_whatsapp_message` | — | `wa_message_id` recebe o `wamid.*` |
| `WhatsappStorage` | 321 | fala com as tabelas, não com o provedor |
| `WhatsappService.listConversations/listMessages` | — | a caixa não sabe de onde veio a mensagem |
| `use-whatsapp-inbox.ts`, `whatsapp-list`, `whatsapp-thread` | 772 | o front da caixa é agnóstico |
| eventos `whatsapp:message` / `whatsapp:status` | — | push já registrado em `lib/realtime.ts` |
| flag `whatsapp_atendimento`, `requirePlanFeature("whatsapp")`, rate limit | — | política, não transporte |
| sweeper de ociosidade (mig 224) | — | ver nota em W1 |

### Muda

| Peça | O que muda |
|---|---|
| `integrations/evolution/` | vira **um adaptador** dentro de um registry de provedores |
| `tb_whatsapp_instance` | ganha `provider`, `waba_id`, token cifrado |
| `WhatsappIngestService` | o payload da Meta é outro formato; o roteamento passa a ser por `phone_number_id` |
| `webhooks.routes.js` → `/whatsapp` | a Meta exige **GET de verificação** e **assinatura HMAC sobre o corpo cru** |
| `WhatsappService.qrcode` | não existe QR na Cloud API — vira Embedded Signup |
| `WhatsappService.sendText` | passa a depender da **janela de 24h** |
| `whatsapp-connect-modal.tsx` | QR → botão que abre o SDK do Facebook |
| `next.config.mjs` (CSP) | liberar `connect.facebook.net` e `www.facebook.com` |

### A lição da mig 223 que se repete igual

> *"a pergunta 'de quem é esta mensagem?' só tem uma resposta legítima: o campo do próprio evento, casado com a instância. Instância desconhecida é IGNORADA — nunca atribuída a alguém."*

Na Cloud API a Meta entrega **todos os clientes no MESMO webhook** (o app da Freelandoo). O campo que roteia é `entry[].changes[].value.metadata.phone_number_id`. **A regra é idêntica e o erro de copiar seria o mesmo:** tratar "a instância" no singular faz a mensagem de um cliente cair na caixa de outro, sem erro nenhum aparecer.

### O invariante que NÃO pode ser perdido

`WhatsappIngestService` **não importa** o módulo de envio. Não existe caminho de código de uma mensagem que chega até uma que sai. Isso não é higiene: é o que sustenta, perante a Meta, que a Freelandoo não opera ferramenta de disparo — o gatilho declarado de ação legal dela desde 07/12/2019. **O adaptador novo não pode quebrar isso:** `whatsappProvider` é importado pelo Service, nunca pelo Ingest.

---

## 2. Slices

Ordenados pelo que destrava a **aprovação** mais cedo: o App Review exige **vídeo do fluxo funcionando**, então não dá para submeter antes do W3.

```
W0 (Alex, dia 0, sem código) ─── Business Verification ── 2-5 dias ──┐
                                                                      │
W1 adaptador + schema ──→ W2 webhook ──→ W3 Embedded Signup ──→ App Review (~1-5d)
                                                     │                │
                                                     └→ W4 envio + janela 24h
                                                        W5 convivência e corte
```

---

### W0 — Verificação e app Meta *(sem código — é o Alex)*

Maior lead time, zero dependência. **Começar hoje.**

1. Meta Business Verification da Freelandoo (CNPJ, documentos) — 2 a 5 dias úteis.
2. Criar o app no Meta for Developers com o use case **WhatsApp**.
3. Preencher ícone, política de privacidade e categoria (pré-requisito do App Review).
4. Guardar `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID` (do Embedded Signup), `META_WEBHOOK_VERIFY_TOKEN`.

**Saída:** negócio verificado + app criado. Sem isso o App Review nem é aceito.

---

### W1 — O adaptador de provedor + schema *(backend, migration)*

Refactor puro: **o Evolution continua funcionando idêntico**. Zero mudança para o usuário.

**`src/integrations/whatsappProvider/`** no padrão já estabelecido pelo `gameProvider` e pelo `PaymentGateway` — registry + contrato, nunca `if (provider === 'cloud')` espalhado. Contrato:

```
provider          'evolution' | 'cloud'   (valor gravado no banco)
isAvailable()     → boolean   — a ENV decide, não a flag (regra da mig 214)
capabilities      { qrPairing, embeddedSignup, serviceWindow, templates }
connect(inst)     → { qr } | { signupUrl }
state(inst)       → { connected, number }
disconnect(inst)
sendText(inst, dest, text)
fetchMedia(inst, mediaId)
```

`capabilities` existe pela mesma razão do `gameProvider`: a Cloud API **não tem QR** e a Evolution **não tem janela de 24h**. A tela omite o que não existe em vez de desenhar um botão morto.

**Migration nova** (a 223 já rodou em produção — não pode ser editada):

- `tb_whatsapp_instance.provider VARCHAR(16) NOT NULL DEFAULT 'evolution'` + CHECK de lista fechada.
- `waba_id VARCHAR(32) NULL`, `access_token_sealed TEXT NULL` (via `utils/secretBox.js`, o mesmo das academias).
- `evolution_instance` **fica com o nome físico legado** e passa a ser o `provider_ref` genérico — na Cloud ela guarda o `phone_number_id`. Mesma disciplina de `tb_machine` (enxames) e `tb_games_presence` (Financeiro): **rename é só de aplicação**, e renomear coluna que a 223 criou quebraria migration histórica.
- O UNIQUE de `evolution_instance` vira **UNIQUE (provider, evolution_instance)** — o espaço de ids dos dois provedores é diferente e não pode colidir.
- `tb_whatsapp_conversation.service_window_expires_at TIMESTAMPTZ NULL` — quando a janela de 24h fecha. **NULL = fechada/desconhecida**, nunca "aberta por omissão": errar para o lado aberto faz o envio ser recusado pela Meta depois de a pessoa já ter digitado.
- `wa_message_id` de VARCHAR(128) → VARCHAR(255) (folga para o `wamid.*`).

**⚠️ O sweeper da mig 224 é só do Evolution.** Ele desliga sessão ociosa porque sessão Baileys custa memória enquanto está de pé. **Na Cloud API não há sessão** — é stateless, e desconectar um cliente ocioso seria arrancar a integração dele sem motivo. O sweeper passa a filtrar `provider = 'evolution'`. Esquecer isso derruba clientes oficiais em 30 dias, em silêncio.

**Validação:** migration 2× em transação com ROLLBACK contra produção; `test:unit`; o Evolution segue funcionando (nenhum comportamento muda).

---

### W2 — O webhook da Meta: o que CHEGA *(backend)*

Testável **antes de qualquer cliente existir** — a Meta fornece número de teste.

**Duas metades que a Evolution não tem:**

1. **GET de verificação.** A Meta chama com `hub.mode`, `hub.verify_token`, `hub.challenge` e espera o challenge de volta em texto puro. Sem isso a inscrição do webhook nem é aceita.
2. **Assinatura `X-Hub-Signature-256`** = HMAC-SHA256 do **corpo cru** com o App Secret. **⚠️ Hoje a rota usa `express.json()`** — precisa de `express.raw()`, como o Stripe já faz no mesmo arquivo. Ler o JSON antes de conferir a assinatura torna a verificação impossível, e o sintoma é uma rota que aceita qualquer corpo da internet.

**Parser novo** (`utils/whatsappCloudPayload.js`, irmão do `whatsappPayload.js`): `entry[].changes[].value` com `messages[]`, `statuses[]` e `metadata.phone_number_id`. Roteamento por `phone_number_id` → `tb_whatsapp_instance`. **Desconhecido é IGNORADO**, nunca atribuído.

**A janela de 24h nasce aqui:** toda mensagem `in` empurra `service_window_expires_at = sent_at + 24h`. É o webhook que sabe quando o cliente falou — calcular isso no envio seria adivinhar.

**Nunca lança por conteúdo** (mesma regra da 223): payload torto vira `ignored`; só erro real sobe, e a Meta reentrega (at-least-once) com o UNIQUE de `wa_message_id` tornando a repetição inofensiva.

**Validação:** suíte nova `test:whatsapp-cloud` com payloads reais da Meta — assinatura válida/inválida, GET de verificação, `phone_number_id` desconhecido, reentrega duplicada, janela sendo empurrada.

---

### W3 — Embedded Signup: o que CONECTA *(backend + front)* ← **destrava o App Review**

**Front:** SDK do Facebook (`connect.facebook.net/en_US/sdk.js`), `FB.login` com `config_id` e `version: "v4"` (⚠️ **a v2 é descontinuada em 15/10/2026** — nascer já na v4 evita retrabalho imediato). O callback devolve, por `message` event: **WABA ID**, **phone number ID** e um **code trocável**. O front manda **só o code** para o backend.

**⚠️ CSP:** `next.config.mjs` precisa de `connect.facebook.net` em `script-src` e `www.facebook.com` em `frame-src`. Sem isso o SDK é bloqueado **sem erro visível** — o botão simplesmente não faz nada.

**Backend** (`POST /whatsapp/cloud/onboard`):
1. Troca o code por **business token do cliente** (server-to-server — o code nunca vira token no browser).
2. **Registra o número** para uso na Cloud API.
3. **Inscreve o app nos webhooks do WABA do cliente** — sem este passo nada chega, e é falha silenciosa: conecta, parece certo, e a caixa fica vazia para sempre.
4. Grava `waba_id`, `phone_number_id` (em `evolution_instance`) e o token **cifrado com `secretBox`**.

**⚠️ O token nunca sai do backend.** Nem para o dono da instância — mesma regra da apikey da Evolution.

**⚠️ Coexistência:** para o número que já está no app WhatsApp Business, inscrever também `history`, `smb_app_state_sync` e `smb_message_echoes`, e sincronizar em até **24h** ou o onboarding tem que recomeçar. Throughput fica fixo em 20 mps — irrelevante para atendimento.

**Depois deste slice:** gravar os vídeos e **submeter o App Review** pedindo Advanced access em `whatsapp_business_messaging` e `whatsapp_business_management`. Dá para gravar com o WABA da própria Freelandoo (Standard access já opera nas contas próprias). **W4 e W5 rodam enquanto a Meta analisa.**

---

### W4 — Envio, janela de 24h e mídia *(backend + front)*

`sendText` do adaptador `cloud`: `POST /{phone_number_id}/messages` com o token do cliente.

**A regra nova que não existe no Evolution:** fora da janela de 24h, texto livre é **recusado pela Meta**. Então:
- O backend recusa antes de chamar a Meta, com motivo — não depois, em erro de API.
- **A caixa mostra o estado**: quanto resta da janela, e quando fechada, o campo desabilitado explicando que só o cliente pode reabrir escrevendo. Um campo que aceita texto e falha no envio é pior que um campo desabilitado.

**Mídia:** `GET /{media_id}` devolve URL temporária; baixar com o token do cliente e servir. **Nada em repouso** — mesma regra da 223: é conteúdo de terceiro que nunca consentiu conosco.

**Validação:** `test:whatsapp-cloud` cobrindo recusa fora da janela, envio dentro, e a janela expirando.

---

### W5 — Convivência e corte *(backend + front)*

Os dois provedores no ar ao mesmo tempo. **Não desligar a Evolution antes** — desligar cedo deixa todo mundo sem canal.

- A tela oferece o oficial a quem está na Evolution, explicando em texto claro **por que** (risco de ban permanente, sem recurso).
- Quem conecta o oficial tem a instância Evolution **desligada na mesma transação** — dois provedores no mesmo número duplicaria toda mensagem recebida.
- **Mitigação que vale desde hoje, antes de tudo:** avisar quem já usa a Evolution a preferir **número secundário, nunca o principal do negócio**.
- `PAYMENT_PROVIDER`-style: `WHATSAPP_PROVIDER=cloud` decide o **padrão para conexões novas**; conexões existentes seguem no provedor gravado na linha. **Provedor sai da linha, nunca do ambiente** — mesma lição do Asaas (mig 236): cobrança feita num provedor é estornada nele mesmo depois da plataforma inteira migrar.

---

## 3. Ordem de execução e dependências

| Slice | Depende de | Pode rodar em paralelo com |
|---|---|---|
| W0 | — | tudo |
| W1 | — | W0 |
| W2 | W1 | W0 |
| W3 | W1, W2, **W0 concluído** | — |
| App Review | W3 | W4, W5 |
| W4 | W1, W3 | App Review |
| W5 | W4 | App Review |

**Caminho crítico = o código, não a Meta.** Somando: 2 a 4 semanas até o primeiro cliente conectado, com a Meta respondendo por menos de uma delas.

---

## 4. ENVs novas

| Variável | Onde | Para quê |
|---|---|---|
| `META_APP_ID` | back + front | SDK e troca de token |
| `META_APP_SECRET` | back | assinatura do webhook e troca de token |
| `META_CONFIG_ID` | front | configuração do Embedded Signup |
| `META_WEBHOOK_VERIFY_TOKEN` | back | GET de verificação |
| `META_GRAPH_VERSION` | back | fixar a versão da Graph API |
| `WHATSAPP_PROVIDER` | back | padrão para conexões novas (`evolution` \| `cloud`) |
| `SECRET_BOX_KEY` | back | **passa a ser obrigatória** — hoje cai no `JWT_SECRET`, e trocar o JWT_SECRET invalidaria os tokens dos clientes |

**Regra da mig 214 mantida:** sem `META_APP_ID`/`META_APP_SECRET` o provedor `cloud` se declara indisponível e a tela **diz isso**, em vez de oferecer um botão que só falha depois do clique.

---

## 5. Armadilhas catalogadas (todas com custo conhecido)

1. **Raw body no webhook** — sem ele não há como conferir a assinatura, e a rota aceita qualquer corpo.
2. **CSP** — SDK bloqueado é falha silenciosa: o botão não faz nada.
3. **Não inscrever os webhooks do WABA do cliente** — conecta, parece certo, caixa vazia para sempre.
4. **Sweeper da 224 atingindo o cloud** — derruba cliente oficial em 30 dias, sem motivo e sem erro.
5. **Embedded Signup v2** — descontinuado em 15/10/2026; nascer em v4.
6. **`phone_number_id` no singular** — a armadilha que a 223 já documentou; aqui ela volta com outro nome.
7. **Janela de 24h "aberta por omissão"** — `NULL` é fechada, não aberta.
8. **Token em claro ou exposto ao dono** — `secretBox`, e nunca sai do backend.
9. **Quebrar o isolamento Ingest ↔ envio** — é o ativo jurídico, não só higiene.
