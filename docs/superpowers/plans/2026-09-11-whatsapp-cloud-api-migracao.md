# Migração WhatsApp: Evolution (não-oficial) → Meta Cloud API oficial

**Data:** 2026-09-11
**Decisão do Alex:** sair da Evolution (Baileys) para a Cloud API oficial, conduzindo as aprovações sozinho, sem BSP e sem custo recorrente.
**Motivo:** o ban do número dos usuários é **permanente e sem recurso**, e a exposição jurídica que ele cria não é principalmente com a Meta — é com o próprio usuário (CDC art. 14, responsabilidade objetiva; cláusula de não-indenizar é nula pelo art. 51, I).

---

## 0. Duas fases, e a primeira entra em dias

A pergunta que definiu o desenho foi do Alex: *"não tem como só eu colocar o cartão e os usuários não precisarem?"* — **tem**, e ela encurta a entrega de semanas para dias.

### Fase 1 — os números moram no WABA da Freelandoo *(agora)*

Um Business Portfolio da Freelandoo; os números dos clientes entram como *business phone numbers* dentro dele. **Um único método de pagamento, o seu.** O cliente não cadastra cartão, não precisa de conta Meta Business, não passa por Embedded Signup — o número dele é verificado por SMS uma vez.

**Por que isso funciona aqui, e não funcionaria num produto de disparo:** o contra clássico do modelo é que os *messaging limits* são do portfólio e compartilhados entre todos os números. Só que

> messaging limits valem **apenas para conversas iniciadas pelo negócio**. Conversas iniciadas pelo cliente **não têm teto**.

O produto é atendimento reativo. O limite compartilhado não entra na conta. Pelo mesmo motivo, **mesmo sem display name aprovado o atendimento funciona** — a punição de 250/24h atinge só disparo ativo.

**E o ganho maior:** Advanced access só é exigido para WABAs *não pertencentes ao seu negócio*. Sendo o WABA seu, **Standard access basta** → sem Tech Provider, sem App Review, sem vídeo, sem Embedded Signup.

**⚠️ Zona cinzenta declarada:** a Meta define partner como quem opera "em nome dos clientes", que é o que a Freelandoo faz. Ela **não proíbe** hospedar números de terceiros no próprio portfólio e a documentação não cobre o caso — o gatilho técnico de Advanced access é a posse do WABA. É um caminho que ela não fecha, não um que ela abençoa. Decisão tomada de olhos abertos; se quiser certeza, o caminho é um ticket ao Direct Support descrevendo o caso, que não bloqueia nada.

### Fase 2 — Tech Provider *(disparada pelo teto de 20)*

O limite de números começa em **2**, sobe **automaticamente até 20** (negócio verificado + uso + qualidade alta), e acima de 20 exige **ticket no Direct Support** (*Account & WABA → Increase WABA limit for a business*). Abrir vários Business Managers **não é saída**.

Ou seja: **a fase 1 não escala por design** — e é exatamente para isso que o Tech Provider existe. Lá cada cliente tem o WABA no portfólio *dele* e o seu teto deixa de existir. Chegar nele com a integração pronta, rodando e com histórico de qualidade é o que faz a Meta aprovar rápido.

**Gatilho:** ao passar de ~15 números conectados, abrir a fase 2.

---

## 1. Coexistência, e o risco que ela traz

**Coexistência é assumida** — o número continua no app WhatsApp Business do profissional, com histórico sincronizado. Tirar o WhatsApp do celular do Ricardo não é uma opção realista para este público; sem coexistência a adoção morre.

O preço é que o comportamento dele **fora** da plataforma passa a tocar um número que está no seu portfólio. Como isso se propaga:

- A qualidade é medida **por número** (bloqueios e denúncias dos clientes dele, janela de 7 dias). O número vira `FLAGGED` e a punição direta — restrição, ban — **é dele**. Você não é banido junto.
- **Mas o crescimento é do portfólio:** a escala automática de limites depende da qualidade agregada de *todos* os seus números. Um número ruim **trava o aumento do teto de 20 para todo mundo**.

> Você não é punido junto. Você fica **preso** junto.

É isso que torna o **W6 (monitor de qualidade)** parte do produto, e não um refinamento: sem ele você só descobre o problema no dia em que o crescimento travar — e aí já não dá para saber quem causou.

Nota de justiça: o risco de ban do número não é criado por você. Quem faz spam hoje já é banido pela Meta, com ou sem Freelandoo. O que muda é que você passa a **herdar uma parte da consequência**.

---

## 2. Mapa: o que se aproveita da mig 223

A mig 223 foi desenhada certo. A instância já é POR PESSOA, o roteamento já é por referência do provedor, e a ingestão já é isolada do envio.

### Sobrevive sem mudança

| Peça | Linhas | Por quê |
|---|---|---|
| `tb_whatsapp_conversation` / `tb_whatsapp_message` | — | acomodam o `wa_id` e o `wamid.*` da Meta |
| `WhatsappStorage` | 321 | fala com as tabelas, não com o provedor |
| `WhatsappService.listConversations/listMessages` | — | a caixa não sabe de onde veio a mensagem |
| `use-whatsapp-inbox.ts`, `whatsapp-list`, `whatsapp-thread` | 772 | front agnóstico |
| `whatsapp:message` / `whatsapp:status` | — | push já registrado em `lib/realtime.ts` |
| flag, `requirePlanFeature("whatsapp")`, rate limit | — | política, não transporte |

### Muda

| Peça | O quê |
|---|---|
| `integrations/evolution/` | vira **um adaptador** dentro de um registry |
| `tb_whatsapp_instance` | ganha `provider`, `waba_id`, token cifrado, qualidade |
| `WhatsappIngestService` | payload da Meta é outro; roteamento por `phone_number_id` |
| webhook `/whatsapp` | GET de verificação + **assinatura HMAC sobre o corpo cru** |
| `WhatsappService.qrcode` | não há QR na Cloud API → vira cadastro de número + SMS |
| `sendText` | passa a depender da **janela de 24h** |
| `whatsapp-connect-modal.tsx` | QR → informar número e confirmar o código |

### A lição da 223 que se repete igual

> *"a pergunta 'de quem é esta mensagem?' só tem uma resposta legítima: o campo do próprio evento, casado com a instância. Instância desconhecida é IGNORADA — nunca atribuída a alguém."*

Na Cloud API a Meta entrega **todos os números no MESMO webhook**. O campo que roteia é `entry[].changes[].value.metadata.phone_number_id`. **Mesma armadilha, outro nome:** tratar "a instância" no singular faz a mensagem de um cliente cair na caixa de outro, sem erro nenhum.

### O invariante que NÃO pode ser perdido

`WhatsappIngestService` **não importa** o módulo de envio. Não existe caminho de código de uma mensagem que chega até uma que sai. Isso sustenta, perante a Meta, que a Freelandoo não opera ferramenta de disparo — o gatilho declarado de ação legal dela desde 07/12/2019. **O registry é importado pelo Service, NUNCA pelo Ingest.**

---

## 3. Slices

```
W0 (Alex, sem código) ── verificação + app Meta ── 2-5 dias ──┐
                                                               │
W1 adaptador + schema ──→ W2 webhook ──→ W3 cadastro de número ──→ W4 envio + janela
                                                                    │
                                                              W5 convivência
                                                              W6 monitor de qualidade
```

### W0 — Verificação e app Meta *(Alex, sem código)*

Maior lead time, zero dependência. **Começa hoje.**

1. Business Verification da Freelandoo (2–5 dias úteis).
2. App no Meta for Developers com use case **WhatsApp**; ícone, política de privacidade, categoria.
3. Criar o WABA da Freelandoo e **cadastrar o método de pagamento** (o único da operação).
4. Gerar **System User token** permanente (é ele que opera os números do portfólio próprio).
5. Guardar `META_APP_ID`, `META_APP_SECRET`, `META_SYSTEM_USER_TOKEN`, `META_WABA_ID`, `META_WEBHOOK_VERIFY_TOKEN`.

### W1 — Adaptador de provedor + schema *(backend, mig 240)*

Refactor puro: **o Evolution continua idêntico**. Zero mudança para o usuário.

`src/integrations/whatsappProvider/` no padrão do `gameProvider`/`PaymentGateway` — registry + contrato, nunca `if (provider === 'cloud')` espalhado:

```
provider       'evolution' | 'cloud'
isAvailable()  → boolean   (a ENV decide, não a flag — regra da mig 214)
capabilities   { qrPairing, numberRegistration, serviceWindow, qualityRating }
connect(inst)  → { qr } | { needsCode }
state(inst)    → { connected, number }
disconnect(inst)
sendText(inst, dest, text)
fetchMedia(inst, mediaId)
```

`capabilities` existe pela mesma razão do `gameProvider`: a Cloud API **não tem QR** e a Evolution **não tem janela de 24h nem quality rating**. A tela omite o que não existe em vez de desenhar botão morto.

**mig 240** (a 223 já rodou em produção — não pode ser editada):

- `tb_whatsapp_instance.provider VARCHAR(16) NOT NULL DEFAULT 'evolution'` + CHECK de lista fechada.
- `waba_id VARCHAR(32) NULL`, `access_token_sealed TEXT NULL` (via `utils/secretBox.js`, o mesmo das academias).
- `quality_rating VARCHAR(16) NULL`, `number_status VARCHAR(24) NULL` — alimentados pelo W6.
- `evolution_instance` **mantém o nome físico legado** e passa a ser o `provider_ref` genérico; na Cloud guarda o `phone_number_id`. Mesma disciplina de `tb_machine` e `tb_games_presence`: **rename é só de aplicação**, e renomear coluna da 223 quebraria migration histórica.
- UNIQUE de `evolution_instance` → **UNIQUE (provider, evolution_instance)**: os espaços de id dos dois provedores são diferentes e não podem colidir.
- `tb_whatsapp_conversation.service_window_expires_at TIMESTAMPTZ NULL`. **NULL = fechada**, nunca "aberta por omissão": errar para o lado aberto faz o envio ser recusado pela Meta depois de a pessoa já ter digitado.
- `wa_message_id` VARCHAR(128) → VARCHAR(255) (folga para o `wamid.*`).

**⚠️ O sweeper da mig 224 é só do Evolution.** Ele desliga sessão ociosa porque sessão Baileys custa memória de pé. **Na Cloud API não há sessão** — desconectar cliente ocioso arrancaria a integração dele sem motivo. Passa a filtrar `provider = 'evolution'`. Esquecer isso derruba clientes oficiais em 30 dias, em silêncio.

### W2 — Webhook da Meta: o que CHEGA *(backend)*

Testável **antes de qualquer cliente** — a Meta fornece número de teste.

1. **GET de verificação** (`hub.mode`, `hub.verify_token`, `hub.challenge` → challenge em texto puro). Sem isso a inscrição nem é aceita.
2. **`X-Hub-Signature-256`** = HMAC-SHA256 do **corpo cru** com o App Secret. **⚠️ Hoje a rota usa `express.json()`** — precisa de `express.raw()`, como o Stripe já faz no mesmo arquivo. Ler o JSON antes torna a verificação impossível, e o sintoma é uma rota pública aceitando qualquer corpo da internet.

`utils/whatsappCloudPayload.js` (irmão do `whatsappPayload.js`): `entry[].changes[].value` com `messages[]`, `statuses[]`, `metadata.phone_number_id`. **Desconhecido é IGNORADO.**

**A janela de 24h nasce aqui:** toda mensagem `in` empurra `service_window_expires_at = sent_at + 24h`. É o webhook que sabe quando o cliente falou.

**Nunca lança por conteúdo** (regra da 223): payload torto vira `ignored`; a Meta reentrega (at-least-once) e o UNIQUE de `wa_message_id` torna a repetição inofensiva.

### W3 — Cadastro do número *(backend + front)*

Muito menor que o Embedded Signup da fase 2.

- `POST /whatsapp/cloud/number` — adiciona o número ao WABA da Freelandoo e dispara o código de verificação (SMS ou chamada).
- `POST /whatsapp/cloud/verify` — confirma o código, registra o número na Cloud API e grava `phone_number_id`.
- **Coexistência:** inscrever também `history`, `smb_app_state_sync`, `smb_message_echoes` e sincronizar em até **24h**, ou o onboarding recomeça. Throughput fixo em 20 mps — irrelevante para atendimento.
- Front: o modal troca o QR por "informe seu número" → "digite o código".

**⚠️ Não inscrever os webhooks é falha silenciosa:** conecta, parece certo, e a caixa fica vazia para sempre.

### W4 — Envio, janela de 24h e mídia *(backend + front)*

`POST /{phone_number_id}/messages` com o System User token.

**A regra que não existe no Evolution:** fora da janela de 24h, texto livre é **recusado pela Meta**. Então o backend recusa **antes** de chamar a Meta, com motivo — não depois, em erro de API —, e a caixa **mostra o estado**: quanto resta da janela e, fechada, o campo desabilitado explicando que só o cliente reabre escrevendo. Campo que aceita texto e falha no envio é pior que campo desabilitado.

**Mídia:** `GET /{media_id}` devolve URL temporária; baixar e servir. **Nada em repouso** — regra da 223: é conteúdo de terceiro que nunca consentiu conosco.

### W5 — Convivência e corte *(backend + front)*

Os dois provedores no ar. **Não desligar a Evolution antes** — desligar cedo deixa todo mundo sem canal.

- A tela oferece o oficial a quem está na Evolution, explicando **por quê** (ban permanente, sem recurso).
- Conectar o oficial **desliga a instância Evolution na mesma transação** — dois provedores no mesmo número duplicaria toda mensagem recebida.
- `WHATSAPP_PROVIDER=cloud` decide o **padrão para conexões novas**; conexões existentes seguem o provedor **gravado na linha**. **Provedor sai da linha, nunca do ambiente** — mesma lição do Asaas (mig 236).
- **Mitigação que vale desde hoje:** avisar quem está na Evolution a preferir número secundário.

### W6 — Monitor de qualidade *(backend + front)* — **não é opcional**

É o que torna a fase 1 segura, porque na coexistência você herda o comportamento externo dos clientes.

- Inscrever `phone_number_quality_update` e `account_update`: **a Meta avisa** quando a qualidade cai.
- Guardar `quality_rating` e `number_status` por instância (colunas da mig 240).
- **Avisar o dono** quando o número dele amarela — ele é quem pode corrigir o comportamento.
- **Painel admin**: lista de números por qualidade, com botão de desconectar quem degrada **antes** de travar o teto do portfólio.

**Sem isto, o sintoma chega como "o limite parou de crescer" e não há como saber quem causou.**

---

## 4. Ordem e dependências

| Slice | Depende de | Paralelo com |
|---|---|---|
| W0 | — | tudo |
| W1 | — | W0 |
| W2 | W1 | W0 |
| W3 | W1, W2, **W0 concluído** | — |
| W4 | W1, W3 | — |
| W5 | W4 | W6 |
| W6 | W2 (webhooks) | W5 |

**W1 e W2 não dependem do W0** — começam antes de qualquer aprovação. E servem às **duas fases**: nada do que for construído agora é jogado fora quando o Tech Provider entrar.

---

## 5. ENVs novas

| Variável | Onde | Para quê |
|---|---|---|
| `META_APP_ID` | back | troca de token, identificação |
| `META_APP_SECRET` | back | assinatura do webhook |
| `META_SYSTEM_USER_TOKEN` | back | operar os números do portfólio próprio |
| `META_WABA_ID` | back | o WABA da Freelandoo (fase 1) |
| `META_WEBHOOK_VERIFY_TOKEN` | back | GET de verificação |
| `META_GRAPH_VERSION` | back | fixar a versão da Graph API |
| `WHATSAPP_PROVIDER` | back | padrão para conexões novas |
| `SECRET_BOX_KEY` | back | **passa a ser obrigatória** — hoje cai no `JWT_SECRET`, e trocá-lo invalidaria os tokens gravados |

**Regra da mig 214 mantida:** sem `META_APP_ID`/`META_APP_SECRET` o provedor `cloud` se declara indisponível e a tela **diz isso**, em vez de oferecer botão que só falha depois do clique.

---

## 6. Armadilhas catalogadas

1. **Raw body no webhook** — sem ele a assinatura é inconferível e a rota aceita qualquer corpo.
2. **CSP** — se a fase 2 trouxer o SDK do Facebook, liberar `connect.facebook.net`/`www.facebook.com`. Bloqueio de CSP é silencioso: o botão não faz nada.
3. **Não inscrever os webhooks** — conecta, parece certo, caixa vazia para sempre.
4. **Sweeper da 224 atingindo o cloud** — derruba cliente oficial em 30 dias, sem erro.
5. **`phone_number_id` no singular** — a armadilha que a 223 já documentou, de volta.
6. **Janela de 24h "aberta por omissão"** — `NULL` é fechada.
7. **Token em claro ou exposto ao dono** — `secretBox`, e nunca sai do backend.
8. **Quebrar o isolamento Ingest ↔ envio** — é ativo jurídico, não higiene.
9. **Ignorar a qualidade (W6)** — o teto do portfólio trava e não se sabe por quem.
