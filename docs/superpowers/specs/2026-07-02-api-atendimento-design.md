# API de Atendimento — conexões externas de mensagens

**Data:** 2026-07-02 · **Status:** aprovado por Alex (brainstorm) · **Escopo:** backend `freelandoo-backend` + frontend `/mensagens`

## Objetivo

Permitir que um software de terceiro (ex.: sistema de atendimento/helpdesk) leia e **responda** as mensagens de um vendedor na Freelandoo via API, com push em tempo real (webhook). O caso de uso central: atender compradores de serviços/O.S. sem estar logado no site.

## Decisões cravadas (Q&A do brainstorm)

1. **Sem QR code.** Pareamento é por **token de API pessoal**: o vendedor gera o token em `/mensagens` → "Conectar atendimento" e cola no software. Modelo OpenAI/Stripe/GitHub.
2. **Escopo de conversas** — a conexão alcança:
   - conversas de **O.S.** do vendedor (sempre);
   - conversas 1-a-1 comuns **criadas depois** da conexão (chegaram com o atendimento ligado);
   - **todo o histórico pessoal 1-a-1** apenas se o toggle `scope_personal` foi ligado na criação do token.
   - **Fora em qualquer escopo:** grupos, chat global, conversas de clan/comunidade.
3. **Só responder.** A API nunca abre conversa nova — só envia em conversa existente dentro do escopo. Anti-spam por construção; não existe endpoint de "abrir conversa".
4. **Push por webhook** (não polling). O software registra a URL via API; a Freelandoo faz POST assinado (HMAC) a cada mensagem recebida, com retry.
5. **Marcação só para o dono.** Mensagem enviada pela API grava `sent_via='api'`; o comprador vê mensagem normal, o dono vê selo discreto "via atendimento" no próprio `/mensagens`.
6. **Envio é texto apenas** (mesmo limite de 4000 chars do chat). Áudio recebido chega no webhook como evento com URL, mas a API não envia áudio.
7. **Apps não têm cadastro próprio na v1** — a credencial é do usuário (conexão), não do software. Um portal de desenvolvedor self-service fica para o futuro; o modelo de dados não bloqueia essa evolução.

## Abordagem

**Espelho fino sobre o `ConversationService` existente + fila de webhook em tabela com sweeper.** Os endpoints externos são wrappers autenticados por token que chamam os mesmos services do `/mensagens` — moderação (leo-profanity/blocked_terms), supervisão parental e rate-limit por usuário vêm de graça e não podem divergir do site. A entrega de webhook segue o padrão já usado no projeto (tabela + retry + sweeper no boot, como temp-compress e webhook events do PayDebug).

Alternativa descartada: worker/fila externa dedicada — overkill para o volume atual; reavaliar se surgir ecossistema aberto.

## 1. Modelo de dados (1 migration nova, numeração seguinte à corrente)

### `tb_api_connection`
| Coluna | Tipo | Nota |
|---|---|---|
| `id_connection` | UUID PK | |
| `id_user` | UUID FK `tb_user` | dono da conexão |
| `name` | VARCHAR(80) | rótulo dado pelo user ("AtendeBot") |
| `token_hash` | VARCHAR(64) | SHA-256 do token; token em claro nunca é salvo |
| `token_prefix` | VARCHAR(16) | ex. `flnd_atd_a1b2` — só para exibição na lista |
| `scope_personal` | BOOLEAN DEFAULT FALSE | toggle "incluir mensagens pessoais" |
| `webhook_url` | TEXT NULL | registrada pelo software via API |
| `webhook_secret` | VARCHAR(64) | gerado na criação; assina o HMAC dos pushes |
| `status` | VARCHAR(16) | `active` / `revoked` |
| `last_used_at` | TIMESTAMPTZ NULL | atualizado (com throttle) pelo middleware |
| `last_ip` | VARCHAR(64) NULL | |
| `created_at` / `revoked_at` | TIMESTAMPTZ | |

Regras: máximo **3 conexões ativas** por user (validação no service). Índice em `token_hash` (lookup do middleware) e parcial em `(id_user) WHERE status='active'`.

### `tb_api_webhook_delivery`
| Coluna | Tipo | Nota |
|---|---|---|
| `id_delivery` | UUID PK | |
| `id_connection` | UUID FK | |
| `event_type` | VARCHAR(40) | v1: `message.received` |
| `payload` | JSONB | corpo exato enviado no POST |
| `status` | VARCHAR(16) | `pending` / `delivered` / `failed` |
| `attempts` | INT DEFAULT 0 | |
| `next_attempt_at` | TIMESTAMPTZ | agenda do retry |
| `last_error` | TEXT NULL | |
| `created_at` / `delivered_at` | TIMESTAMPTZ | |

Índice parcial `(next_attempt_at) WHERE status='pending'` para o sweeper.

### `tb_message.sent_via`
Coluna nova `VARCHAR(8) NOT NULL DEFAULT 'app'`, CHECK `('app','api')`. Alimenta o selo do dono.

## 2. Autenticação

- Token no formato `flnd_atd_<random ~32 bytes base62>`; exibido **uma única vez** na criação.
- Middleware `apiConnectionAuth`: extrai Bearer, SHA-256, busca `tb_api_connection` ativa, injeta `req.apiConnection` + `req.user` (o dono), atualiza `last_used_at`/`last_ip` com throttle (ex.: no máx. 1× por minuto).
- Rate limit por conexão nos endpoints `/ext/v1` (além do rate-limit por user já dentro do `sendMessage`).
- Revogação: `status='revoked'` → 401 imediato.

## 3. Endpoints

### Internos (JWT normal + proxy Next) — gestão das conexões
- `GET /me/api-connections` — lista (nome, prefixo, escopo, último uso, IP, status)
- `POST /me/api-connections` `{ name, scope_personal }` — cria; resposta inclui o **token em claro (única vez)**
- `POST /me/api-connections/:id/revoke`

### Externos — namespace `/ext/v1` (Bearer token da conexão)
| Endpoint | Função |
|---|---|
| `GET /ext/v1/me` | Valida token; retorna conexão, escopo, user/perfis |
| `POST /ext/v1/webhook` `{ url }` | Registra/atualiza webhook; retorna `webhook_secret`. HTTPS obrigatório; anti-SSRF (bloqueia IP privado/localhost/link-local, resolve DNS antes) |
| `GET /ext/v1/conversations?cursor&updated_since` | Conversas no escopo, mais recentes primeiro |
| `GET /ext/v1/conversations/:id/messages?cursor` | Histórico paginado (mesmo shape do interno) |
| `POST /ext/v1/conversations/:id/messages` `{ body }` | **Responder** — só conversa existente e no escopo; passa por `ConversationService.sendMessage`; grava `sent_via='api'`, `sender_user_id` = dono, sender = o perfil do dono participante da conversa |
| `POST /ext/v1/conversations/:id/read` | Marcar lida |

Erros seguem o padrão do projeto (`{ error }` → `sendServiceResult`). Fora do escopo = 403; token inválido/revogado = 401.

## 4. Webhook push

- **Evento `message.received`**: dispara quando **o outro lado** envia mensagem em conversa dentro do escopo de alguma conexão ativa do dono. Mensagens enviadas pela própria API **não** geram eco (anti-loop); mensagens que o dono digita no site também não geram evento na v1.
- Payload: `{ event, id_delivery, created_at, conversation: {...}, message: { id, body, kind, audio_url?, sender: {...} } }`.
- Headers: `X-Freelandoo-Signature: sha256=HMAC-SHA256(webhook_secret, raw_body)` + `X-Freelandoo-Timestamp`.
- Disparo: hook fire-and-forget no fluxo de mensagem (mesmo padrão dos hooks de notificação) → insere row `pending` → tenta entrega imediata → sucesso marca `delivered`.
- Retry com backoff: 1min, 5min, 15min, 1h, 6h → depois `failed`. Sweeper com `setInterval` iniciado no boot (padrão do projeto). Timeout de POST curto (ex.: 10s); 2xx = entregue.

## 5. Frontend (`/mensagens`)

- Ação **"Conectar atendimento"** → painel/modal reto (`.fl-sharp`, dark, sem border-radius) com:
  - lista de conexões: nome, `token_prefix…`, escopo, último uso, IP, botão **Revogar**;
  - criar nova: campo nome + toggle "Permitir responder também minhas mensagens pessoais" → tela de token exibido **uma vez** com copiar + aviso "guarde agora, não será mostrado de novo".
- Selo "via atendimento" na bolha quando `sent_via='api'` — **apenas na visão do dono** (o payload do endpoint interno de mensagens passa a expor `sent_via`; o público/outro lado não recebe o campo).
- **i18n pt/en/es no mesmo commit** (regra permanente; script merge idempotente, ns `Messages` ou novo `ApiConnections`).
- Feature flag **`atendimento_api`** (kill-switch mig 168): `requireFeature()` nas rotas `/ext/v1` e `useFeature()` para esconder o botão.

## 6. Segurança (resumo)

- Token hasheado (SHA-256), prefixo identificável, exibição única, revogação 1-clique, `last_used_at`/`last_ip` visíveis ao dono.
- HMAC no webhook + anti-SSRF na URL.
- Envio reusa `sendMessage` real → moderação de chat, supervisão parental e rate-limit idênticos ao site.
- Escopo verificado a cada request (não só na listagem): responder exige que a conversa passe o mesmo predicado de escopo.

## 7. Fatiamento (5 slices)

1. **Slice 1 (back):** migration (`tb_api_connection`, `tb_api_webhook_delivery`, `tb_message.sent_via`) + CRUD `/me/api-connections` + middleware `apiConnectionAuth`.
2. **Slice 2 (back):** endpoints `/ext/v1/*` (me, webhook, conversations, messages, send, read) reusando `ConversationService` + predicado de escopo.
3. **Slice 3 (back):** dispatch de webhook (hook no fluxo de mensagem + sweeper de retry + HMAC + anti-SSRF).
4. **Slice 4 (front):** painel "Conectar atendimento" em `/mensagens` + selo `sent_via` + i18n 3 idiomas + flag `atendimento_api`.
5. **Slice 5:** `docs/API_ATENDIMENTO.md` (contrato para o dev do software: auth, endpoints, assinatura do webhook, exemplos curl) + script simulador de atendimento (`scripts/`) para teste e2e local.

## Fora de escopo (v1)

- Portal de desenvolvedor self-service / cadastro de apps.
- Envio de áudio/anexos pela API.
- Abrir conversas (outbound) — nem com relação comercial.
- Eventos além de `message.received` (ex.: `conversation.read`, echo de mensagens próprias).
- Selo visível ao comprador.
