# API de Atendimento — Freelandoo

Integre seu software de atendimento para ler e **responder** as mensagens da sua conta.
A API só responde conversas existentes — nunca inicia conversa nova.

## Autenticação

1. Em **freelandoo.com/mensagens → Conectar atendimento**, gere um token (`flnd_atd_...`).
   Ele aparece UMA única vez.
2. Envie em todo request: `Authorization: Bearer flnd_atd_...`
3. Base URL: a mesma do backend Freelandoo. Prefixo: `/ext/v1`.

Limite: 60 requests/minuto por conexão (HTTP 429 com `Retry-After` ao exceder).
Token revogado no site → 401 imediato.

## Escopo

Sua conexão enxerga:
- **O.S.** (ordens de serviço) onde você é o profissional — sempre;
- conversas diretas **criadas depois** da conexão;
- todo o histórico pessoal 1-a-1, **somente** se você marcou "incluir mensagens
  pessoais" ao gerar o token.

Grupos, chat global e comunidades ficam fora. Envio é **texto** (máx. 4000 chars).

## Ids de conversa

Unificados no formato `tipo:uuid`:
- `dm:<uuid>` — conversa direta 1-a-1;
- `os:<uuid>` — chat de uma O.S. (o uuid é o id_response).

## Endpoints

### `GET /ext/v1/me`
Valida o token. → `{ connection: { name, scope_personal, webhook_url, created_at }, user: { id_user, username } }`

### `POST /ext/v1/webhook`
Registra a URL que recebe push. Body: `{ "url": "https://seu-sistema.com/hook" }`
→ `{ webhook_url, webhook_secret }` — guarde o `webhook_secret` para validar a assinatura.
HTTPS obrigatório; hosts de rede privada são recusados.

### `GET /ext/v1/conversations?updated_since=<ISO>&limit=<n>`
Conversas no escopo, mais recentes primeiro (máx. 100).
→ `{ items: [{ id, type: "dm"|"os", created_at, last_message_at, last_message_preview, my_profile_id, counterpart, request? , status? }] }`

### `GET /ext/v1/conversations/:id/messages`
Histórico. Para `dm:` aceita `?cursor=&limit=`; para `os:` retorna a thread inteira.
Atenção: para `os:` a leitura marca a thread como lida (mesmo comportamento do site).

### `POST /ext/v1/conversations/:id/messages`
Responde. Body: `{ "body": "texto da resposta" }` → `201 { message: {...} }`
Erros: `403` fora do escopo/conversa encerrada, `429` rate limit, `{ error }` nos demais.
A resposta sai em seu nome com a marca interna `sent_via: "api"` (visível só para você no site).

### `POST /ext/v1/conversations/:id/read`
Marca como lida.

## Webhook (push)

A cada mensagem **recebida** (o outro lado falou) numa conversa do escopo, fazemos:

```
POST <sua url>
Content-Type: application/json
X-Freelandoo-Timestamp: 1751468400
X-Freelandoo-Signature: sha256=<hmac>
```

Corpo (`message.received`):

```json
{
  "event": "message.received",
  "created_at": "2026-07-02T14:00:00.000Z",
  "conversation": { "id": "dm:0d3e...", "type": "dm", "created_at": "..." },
  "message": {
    "id_message": "9a1c...",
    "body": "Olá, comprei o serviço e tenho uma dúvida",
    "kind": "text",
    "created_at": "...",
    "sender": { "id_profile": "...", "display_name": "...", "username": "..." }
  }
}
```

Para O.S., `conversation.type = "os"` e vem `conversation.request` (descrição, estado, município).
Mensagens que VOCÊ envia (site ou API) não geram evento — sem eco.

### Validando a assinatura (Node)

```js
const crypto = require("crypto");
function isValid(req, rawBody, secret) {
  const ts = req.headers["x-freelandoo-timestamp"];
  const sig = req.headers["x-freelandoo-signature"] || "";
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // anti-replay 5min
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
```

### Entrega e retry

Timeout de 10s; qualquer resposta 2xx conta como entregue.
Falhou → retry com backoff: 1min, 5min, 15min, 1h, 6h (5 tentativas, depois descarta).
Seu endpoint deve ser idempotente por `message.id_message`.

## Teste local

Simulador de atendimento (echo bot) neste repo: `scripts/atendimento-simulator.js`.

```bash
# backend rodando local com ALLOW_INSECURE_WEBHOOK=1 (libera http://localhost)
FLND_TOKEN=flnd_atd_xxx BACKEND_URL=http://localhost:3000 node scripts/atendimento-simulator.js
```
