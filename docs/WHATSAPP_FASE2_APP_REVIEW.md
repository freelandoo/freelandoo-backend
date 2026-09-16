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
| App ID | `1591190522483184` | existe |
| WABA | `1745921236638169` (`freelandoo`, BRL, fuso 25) | **`account_review_status: APPROVED`** |
| Portfólio dono | `1524179176025054` — **nome `printtei_`** | ⚠️ ver §5 |
| Números | 1 — `+55 11 96812-8174`, `CONNECTED`, `VERIFIED`, **`GREEN`** | saudável |
| Templates | **`hello_world` · APPROVED · UTILITY · en_US** | ✅ dá para gravar o vídeo 1 hoje |
| Escopos do token | `whatsapp_business_management`, `whatsapp_business_messaging`, `public_profile` — **expira: nunca** | falta `business_management` |

---

## 2. PASSO 0 — 5 minutos, destrava duas respostas

O token **não tem `business_management`**. Conferido: ler o portfólio devolve

```
(#200) Requires business_management permission to manage the object
```

Enquanto faltar, **não dá para saber**:

1. se o **teto de números é 2 ou 20**, e
2. se a **Business Verification está aprovada** — que é o pré-requisito do App
   Review, ou seja, o primeiro degrau desta lista inteira.

**O que fazer:** Business Settings → Users → System Users → o system user da
Freelandoo → *Generate Token* incluindo **`business_management`**. Alternativa
sem tocar em token: Business Settings → **Business Info**, e ler o status de
verificação na tela.

> Se a verificação já estiver aprovada, você **pula o passo de maior lead time**
> e vai direto ao App Review.

---

## 3. A ordem (é fixa — a Meta não deixa pular)

```
1. Business Verification  ──►  2. App configurado  ──►  3. App Review
                                                             │
                                                             ▼
                                              4. webhooks + onboarding de clientes
```

### 3.1 Business Verification

Nome, endereço, telefone, e-mail e site do negócio, mais um método de contato
para a Meta confirmar. Documento societário se o negócio não for encontrado
sozinho.

### 3.2 App configurado

Três campos que reprovam sozinhos se faltarem: **ícone**, **política de
privacidade** (URL pública) e **categoria**.

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

O portfólio dono do WABA é **`printtei_`**, e o app/produto é **Freelandoo**.
Review de identidade compara o que você diz ser com o que está registrado, e
nome que não bate é motivo comum de pedido de esclarecimento.

**Antes de submeter:** renomear o portfólio para o nome do negócio (Business
Settings → Business Info → *Edit*) e conferir se ele bate com a razão social
usada na verificação e com o site informado.

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
