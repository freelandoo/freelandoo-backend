# WhatsApp fase 2 (Tech Provider) — o que a Meta exige e como provar

> **Para quem:** o Alex, executando os passos no painel da Meta.
> **O que este doc NÃO é:** plano de implementação. Ele cobre o que depende da
> Meta — verificação, App Review e os dois vídeos. O código da fase 2 está no
> fim, como lista curta.
>
> ⚠️ **Nenhum segredo aqui.** Este arquivo é versionado. Token, App Secret e
> verify token vivem no Railway (serviço do backend). Onde o comando pedir um,
> o valor é colado na hora e **não** volta para cá.

---

## O que fazer agora (resumo)

Tudo abaixo foi conferido na Graph API em **2026-09-16**, não é suposição.

1. **Preencher 3 campos do app** — política de privacidade, categoria e ícone.
   Estão **vazios** hoje, e cada um reprova sozinho. Os valores prontos estão
   na §3.2. *(~15 min)*
2. **Gravar os dois vídeos** — §4. O `hello_world` já está APPROVED e o número
   está CONNECTED/GREEN, então **o vídeo 1 é gravável hoje**, sem construir
   nada. *(~30 min)*
3. **Submeter o App Review** pedindo Advanced access nas duas permissões. §3.3.

**Não precisa mais:** Business Verification — **já está aprovada** (§2). Era o
passo de maior lead time, e ele saiu do caminho.

**Não faça:** renomear o portfólio `printtei_` (§5) — a verificação está
concedida sob esse nome, e mexer nele pode disparar reverificação.

---

## 0. Por que a fase 2, em uma frase

Sem Tech Provider **não existe coexistência**, e sem coexistência o cliente
entrega o número e **perde o WhatsApp do celular**. O teto de números (2→20) é
o motivo secundário; o real é que hoje nenhum cliente de verdade aceita o
combinado.

Confirmado na doc da Meta: coexistência exige *"Solution Partner or Tech
Provider"* **e** Embedded Signup, sem caminho alternativo, e o WABA passa a ser
**do cliente**.

---

## 1. Estado conferido (2026-09-16)

Lido direto na Graph API com o token de produção:

| item | valor | leitura |
|---|---|---|
| App | `1591190522483184` — **`zap-freelandoo`** | existe |
| WABA | `1745921236638169` (`freelandoo`, BRL, fuso 25) | **`account_review_status: APPROVED`** |
| **Business Verification** | **`business_verification_status: verified`** | ✅ **já aprovada — ver §2** |
| Portfólio dono | `1524179176025054` — **nome `printtei_`** | ⚠️ ver §5 |
| Números | 1 — `+55 11 96812-8174`, `CONNECTED`, `VERIFIED`, **`GREEN`** | saudável |
| Templates | **`hello_world` · APPROVED · UTILITY · en_US** | ✅ dá para gravar o vídeo 1 hoje |
| Escopos do token | `whatsapp_business_management`, `whatsapp_business_messaging`, `public_profile` — **expira: nunca** | falta `business_management` |

---

## 2. A Business Verification **já está aprovada** — o degrau mais longo saiu do caminho

O pré-requisito do App Review, e o passo de maior lead time desta lista inteira,
**já está feito**. A Graph API devolve, no objeto do WABA:

```
business_verification_status: "verified"
```

⚠️ **Isso é legível sem o escopo `business_management`** — ele é exigido para
ler o objeto do portfólio direto, não este campo no WABA. Uma versão anterior
deste doc afirmava que a resposta estava bloqueada; estava errada, e a
consequência era mandar você refazer uma verificação que já existe.

**Então a §3.1 está concluída. Você vai direto ao App Review (§3.3).**

### O que o escopo faltante ainda esconde

Sobrou **uma** pergunta atrás dele: **o teto de números é 2 ou 20?** Ler o
portfólio devolve

```
(#200) Requires business_management permission to manage the object
```

Isso **não bloqueia o App Review** — é planejamento de capacidade, não
pré-requisito. Se quiser a resposta: Business Settings → Users → System Users →
o system user da Freelandoo → *Generate Token* incluindo
**`business_management`**. Ou, sem tocar em token, ler o limite na tela do
WhatsApp Manager.

---

## 3. A ordem (é fixa — a Meta não deixa pular)

```
1. Business Verification  ──►  2. App configurado  ──►  3. App Review
        ✅ FEITA              ⬅ AQUI — 3 campos VAZIOS      │
                                                             ▼
                                              4. webhooks + onboarding de clientes
```

### 3.1 Business Verification — ✅ concluída

Nada a fazer. Confirmado em 2026-09-16 (§2).

### 3.2 App configurado — ⚠️ **é aqui que você está, e os 3 bloqueadores estão VAZIOS**

Conferido em 2026-09-16 lendo o app `1591190522483184` com o app token. Os três
campos que **reprovam sozinhos** estão sem valor:

| campo | hoje | o que pôr |
|---|---|---|
| **Política de privacidade** | *** vazio *** | `https://www.freelandoo.com.br/privacy-policy` — **conferido, responde 200** |
| **Categoria** | *** vazio *** | *Business and Pages* (ou *Productivity*) |
| **Ícone** | ícone **padrão** do Facebook (`rsrc.php/…`) | 1024×1024 com a marca — ⚠️ **não existe pronto**, ver nota |
| Termos de serviço | *** vazio *** | `https://www.freelandoo.com.br/terms` — **conferido, 200** (não obrigatório, mas some do checklist) |

Onde: **App Dashboard → Settings → Basic**. Salvar.

> ⚠️ **O ícone precisa ser gerado — não há asset no tamanho.** O maior que o
> front tem é **666×666** (`public/icon.png`, `apple-icon.png` e
> `freelandoo-logo.png` são o mesmo arquivo; `public/icons/icon-512.png` tem
> 512). **Não existe SVG da marca** no repo — os únicos vetores são os dos
> Poléns —, então dá para ampliar o 666 ou reexportar do original. A Meta pede
> **1024×1024**.
>
> ⚠️ **O ícone padrão conta como ausente.** O que está lá é o placeholder que
> todo app novo recebe, não uma escolha — um review de identidade lê isso como
> app não configurado.
>
> ⚠️ E o app se chama **`zap-freelandoo`**. Se quiser que o nome exibido no
> review seja o do produto, é neste mesmo lugar — renomear o **app** é
> inofensivo (diferente de renomear o **portfólio**, ver §5).

### 3.3 App Review — Advanced access

Pedir **Advanced access** para as duas permissões:

- `whatsapp_business_messaging` — enviar mensagem em nome dos clientes
- `whatsapp_business_management` — acessar os WABAs dos clientes

E anexar **dois vídeos** (§4).

---

## 4. Os dois vídeos

A Meta aceita, no lugar de demonstrar dentro do app, **screencast do cURL** e
**screencast do WhatsApp Manager**. É por isso que isto é gravável hoje, sem
construir nada.

> ⚠️ Tem que ser **gravação real da sua tela**. Vídeo montado ou recriado é o
> caminho mais curto para reprovar o app — e reprovação por evidência fabricada
> é bem mais cara que uma por vídeo tremido.

### Vídeo 1 — "mensagem criada/enviada pelo app, recebida no WhatsApp"

**Alternativa aceita:** screencast do cURL do *API Setup* enviando a mensagem.

**Roteiro (~60 s):**

1. Abra o terminal e deixe um celular com o WhatsApp à vista (ou o WhatsApp Web).
2. Comece a gravar.
3. Cole o token na variável — o valor sai do Railway (`META_SYSTEM_USER_TOKEN`).
   **Deixe essa linha fora do enquadramento**, ou limpe a tela depois: o token
   não pode aparecer no vídeo.
4. Rode o comando abaixo com `DESTINO` = **o seu número pessoal**, formato
   internacional só com dígitos (ex.: `5511999999999`).
5. Mostre a resposta com `"messages":[{"id":"wamid...."}]`.
6. **Vire a câmera para o celular** e mostre a mensagem *Hello World* chegando.

```bash
TOKEN='<cole aqui — Railway: META_SYSTEM_USER_TOKEN>'
DESTINO='55DDDNUMERO'

curl -sS -X POST \
  "https://graph.facebook.com/v21.0/1308289759033433/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
        \"messaging_product\": \"whatsapp\",
        \"to\": \"$DESTINO\",
        \"type\": \"template\",
        \"template\": { \"name\": \"hello_world\", \"language\": { \"code\": \"en_US\" } }
      }"
```

**Por que template e não texto livre:** fora da janela de 24h a Meta **recusa**
texto livre. `hello_world` é template aprovado e sai sempre — é exatamente o
que o *API Setup* do painel usa.

**Custo:** `hello_world` é UTILITY iniciada pelo negócio, então é cobrada
(centavos). Service, e utility *em resposta ao cliente*, seguem gratuitas.

`1308289759033433` é o `phone_number_id` do `+55 11 96812-8174`. Ele está no
banco em `tb_whatsapp_instance.evolution_instance` (nome de coluna legado, ver
mig 240) e também no painel.

### Vídeo 2 — "o app criando um template"

**Alternativa aceita:** screencast do **WhatsApp Manager** criando o template.

Use a alternativa. A Freelandoo **não cria template** e **não deve passar a
criar**: ela não opera ferramenta de disparo, e é isso que o
`whatsappIngestIsolation.test.js` prova por construção. Construir gestão de
template só para passar no review contradiz o produto.

**Roteiro (~90 s):** WhatsApp Manager → *Modelos de mensagem* → **Criar modelo**
→ categoria **Utility** → nome (ex.: `agendamento_confirmado`) → idioma
**Português (BR)** → corpo com variável, por exemplo:

```
Olá {{1}}, seu horário em {{2}} está confirmado. Qualquer mudança, é só responder por aqui.
```

→ **Enviar**. Mostre o template aparecendo na lista com status
`PENDING`/`APPROVED`.

---

## 5. Atrito previsto: o portfólio se chama `printtei_`

O portfólio dono do WABA é **`printtei_`**, o app é **`zap-freelandoo`** e o
produto é **Freelandoo**. Review de identidade compara o que você diz ser com o
que está registrado, e nome que não bate é motivo comum de pedido de
esclarecimento.

**⚠️ NÃO renomeie o portfólio por reflexo.** Uma versão anterior deste doc
mandava renomear antes de submeter — conselho que ficou perigoso quando se
descobriu que **a verificação já está concedida sob esse nome** (§2). A Meta
pode exigir **reverificação** quando os dados cadastrais do negócio mudam, e
reverificar custa justamente o degrau de maior lead time, que hoje está pronto.
Trocar o nome para "ficar bonito no review" pode derrubar o que já passou.

**O que fazer em vez disso:**

1. Submeta com o nome como está.
2. Use o **campo de notas do App Review** para dizer, em uma linha, que
   `printtei_` é o portfólio que opera o produto Freelandoo — explicação dada
   de antemão vale mais que nome trocado às pressas.
3. Se a Meta pedir esclarecimento, aí sim avalie renomear, **sabendo** que pode
   vir reverificação junto.

---

## 6. Depois de aprovado — o que é código

| # | frente | tamanho | nota |
|---|---|---|---|
| 1 | `SECRET_BOX_KEY` no Railway | 1 min | **já é seguro** — ver §7 |
| 2 | `configFor(instance)` no `cloud.js` | pequeno | hoje `config()` lê só o ENV; passa a preferir `access_token_sealed`. A coluna **já existe** (mig 240) → **sem migration nova** |
| 3 | **Hosted Embedded Signup** | pequeno–médio | a Meta hospeda o fluxo; evita escrever e hospedar o SDK. **É o caminho recomendado** |
| 4 | CSP do front | 1 linha | `connect.facebook.net` **não está** no `script-src`. Bloqueio de CSP é **silencioso** — o botão não faz nada. Só necessário no ES clássico |
| 5 | coexistência | médio | inscrever `smb_message_echoes`, `history`, `smb_app_state_sync` e tratar o echo — é o que faz a caixa mostrar o que o dono respondeu **pelo celular** |
| 6 | sincronizar histórico em ≤24h | médio | senão o onboarding recomeça |

`account_update` **já está inscrito** (veio do W6) — é o webhook que avisa
quando um cliente conclui o Embedded Signup.

### Pendência da fase 1, independente disto

`fetchMedia` ainda é `notYet("download de mídia")`: foto, áudio e documento
chegam como rótulo (`📷 Imagem`) e **não abrem**. Para oficina e barbearia,
metade das mensagens é foto — provavelmente vale mais que tudo nesta lista.

---

## 7. `SECRET_BOX_KEY` — por que definir já é seguro (e não era)

Havia uma armadilha real: **2 academias em produção** têm o token da Gym
Provider API selado com o **`JWT_SECRET`**. Como `secretBox` derivava a chave de
`SECRET_BOX_KEY || JWT_SECRET`, definir a variável faria as duas **pararem de
abrir** — e o GCM não decifra errado, ele estoura:

```
Unsupported state or unable to authenticate data
```

O sintoma chegaria dias depois, como uma academia que parou de sincronizar sem
ninguém ter mexido nela.

**Corrigido:** `open()` agora tenta as chaves **na ordem** (preferida, depois o
fallback) e `seal()` usa sempre a preferida. Definir a variável passou a ser
inofensivo. Travado por `test/unit/secretBox.test.js`, com o defeito conferido
de volta.

**Continua valendo:** rotacionar o `JWT_SECRET` só é seguro **depois** de
re-selar. Para isso existe:

```bash
node scripts/reseal-secrets.js            # simulação, não grava
node scripts/reseal-secrets.js --apply    # grava
```

Rodar com as **duas** variáveis no ambiente. Idempotente.

⚠️ **Coluna selada nova entra na lista `ALVOS` do script** — fora dela, ela fica
presa ao `JWT_SECRET` para sempre, e ninguém descobre até a rotação quebrar
aquele recurso.

---

## Fontes

- [Become a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
- [Solution Providers / Tech Providers — overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview)
- [Onboard WhatsApp Business app users (coexistência)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [Reconnect offboarded coexistence clients](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/reconnect-offboarded-coexistence-clients/)
- [Embedded Signup — overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/)
- [Pricing on the WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
