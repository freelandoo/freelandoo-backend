# API de Atendimento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que software de terceiro (helpdesk) leia e responda as mensagens de um vendedor via API com token pessoal + webhook push, conforme spec `docs/superpowers/specs/2026-07-02-api-atendimento-design.md`.

**Architecture:** Espelho fino sobre `ConversationService`/`ServiceRequestService` existentes (moderação/supervisão/rate-limit reusados), autenticado por token hasheado em `tb_api_connection`. Ids externos unificados: `dm:<id_conversation>` (chat 1-a-1) e `os:<id_response>` (chat de O.S. — **sistema separado**, `tb_service_request_message`). Webhook = tabela `tb_api_webhook_delivery` + entrega imediata + sweeper de retry no boot (padrão `index.js` do projeto).

**Tech Stack:** Express 5 + pg puro (sem ORM), camadas routes→controllers→services→storages, `runWithLogs`, `sendServiceResult`, `asyncHandler`. Frontend Next.js 16 App Router, i18n 3 idiomas obrigatório, `.fl-sharp` (sem cantos arredondados).

**Repos:** backend = `freelandoo-backend/` (CWD deste plano). Frontend = `../freelandoo frontend/freelandoo-website-main/` (path com espaço — SEMPRE quotar; commit só de caminhos explícitos, NUNCA `git add -A`).

**Fatos do codebase que o plano usa (já verificados):**
- Última migration: `170_vaquinha.sql` → a nova é **171**.
- `tb_conversation` (mig 027/078): `kind` `'direct'|'group'`, `entity_a_id/entity_b_id` → `tb_profile`. `tb_message`: `sender_entity_id`, `sender_user_id`, `body`, `kind`.
- O.S. chat: `tb_service_request_message(id_response, sender 'USER'|'PRO', content)` — thread = `tb_service_request_response` (status ativos `PENDING`,`PRO_ACCEPTED`).
- `ConversationService.sendMessage(user, payload)` resolve ator via `resolveActor(conn, user, {actor_type, actor_id})`; `ServiceRequestService.sendMessage(user, id_response, body)` resolve o lado (`USER`/`PRO`) sozinho pelo `user`.
- Feature flags: `tb_feature_flag` (mig 168), `requireFeature("chave")` middleware, `useFeature("chave")` no front (`components/feature-flags/FeatureFlagsProvider.tsx`).
- Jobs de boot: `index.js` raiz do backend (setTimeout/setInterval após `app.listen`).
- Rotas montadas em `src/routes/index.js` (ex.: `app.use("/conversations", conversationRoutes)`).
- Proxy front: padrão `app/api/conversations/_proxy.ts` (`getBackendApiUrl` de `@/lib/backend`).
- `/mensagens` = `components/mensagens/MensagensClient.tsx` (ns i18n `"Messages"`), tipos em `components/mensagens/types.ts`.

**Validação (não há Jest no backend):** cada arquivo novo passa `node --check`; `npm run lint` nos dois repos; `npm run build` no front; e2e manual via simulador (Task 16). Commits por slice, padrão `feat(atendimento-api): slice N — descrição`.

---

## SLICE 1 — Migration + CRUD de conexões + middleware de auth

### Task 1: Migration 171

**Files:**
- Create: `src/databases/migrations/171_api_connections.sql`

- [ ] **Step 1: Escrever a migration** (idempotente; ATENÇÃO: migration com erro derruba o boot — conferir nº de colunas = nº de valores)

```sql
-- =============================================================================
-- Migration 171: API de Atendimento (conexões externas de mensagens)
-- =============================================================================
-- tb_api_connection: token pessoal (hash SHA-256) que autoriza um software de
-- terceiro a ler/responder mensagens do dono. Escopo: O.S. sempre + conversas
-- diretas criadas após a conexão + (scope_personal) histórico pessoal.
-- tb_api_webhook_delivery: fila/log de entrega de webhook com retry.
-- sent_via em tb_message e tb_service_request_message: selo "via atendimento"
-- visível só para o dono.
-- Idempotente (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS antes de ADD).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_api_connection (
  id_connection   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user         UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  name            VARCHAR(80)  NOT NULL,
  token_hash      VARCHAR(64)  NOT NULL,
  token_prefix    VARCHAR(20)  NOT NULL,
  scope_personal  BOOLEAN      NOT NULL DEFAULT FALSE,
  webhook_url     TEXT         NULL,
  webhook_secret  VARCHAR(64)  NOT NULL,
  status          VARCHAR(16)  NOT NULL DEFAULT 'active',
  last_used_at    TIMESTAMPTZ  NULL,
  last_ip         VARCHAR(64)  NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ  NULL,
  CONSTRAINT tb_api_connection_status_chk CHECK (status IN ('active','revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_api_connection_token_hash
  ON public.tb_api_connection (token_hash);

CREATE INDEX IF NOT EXISTS idx_api_connection_user_active
  ON public.tb_api_connection (id_user)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.tb_api_webhook_delivery (
  id_delivery     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_connection   UUID         NOT NULL REFERENCES public.tb_api_connection(id_connection) ON DELETE CASCADE,
  event_type      VARCHAR(40)  NOT NULL,
  payload         JSONB        NOT NULL,
  status          VARCHAR(16)  NOT NULL DEFAULT 'pending',
  attempts        INT          NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_error      TEXT         NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ  NULL,
  CONSTRAINT tb_api_webhook_delivery_status_chk CHECK (status IN ('pending','delivered','failed'))
);

CREATE INDEX IF NOT EXISTS idx_api_webhook_delivery_due
  ON public.tb_api_webhook_delivery (next_attempt_at)
  WHERE status = 'pending';

ALTER TABLE public.tb_message
  ADD COLUMN IF NOT EXISTS sent_via VARCHAR(8) NOT NULL DEFAULT 'app';
ALTER TABLE public.tb_message
  DROP CONSTRAINT IF EXISTS tb_message_sent_via_chk;
ALTER TABLE public.tb_message
  ADD CONSTRAINT tb_message_sent_via_chk CHECK (sent_via IN ('app','api'));

ALTER TABLE public.tb_service_request_message
  ADD COLUMN IF NOT EXISTS sent_via VARCHAR(8) NOT NULL DEFAULT 'app';
ALTER TABLE public.tb_service_request_message
  DROP CONSTRAINT IF EXISTS tb_service_request_message_sent_via_chk;
ALTER TABLE public.tb_service_request_message
  ADD CONSTRAINT tb_service_request_message_sent_via_chk CHECK (sent_via IN ('app','api'));

INSERT INTO public.tb_feature_flag (flag_key, label, description)
VALUES (
  'atendimento_api',
  'API de Atendimento',
  'Conexões externas de mensagens: tokens de API pessoais gerados em /mensagens que permitem a um software de atendimento ler e responder conversas (O.S. + diretas) via /ext/v1 com webhook push. Desligar bloqueia as rotas /ext/v1 (403) e esconde o botão "Conectar atendimento". Tokens e histórico de entregas são preservados.'
)
ON CONFLICT (flag_key) DO NOTHING;

COMMIT;
```

- [ ] **Step 2: Validar sintaxe SQL localmente** (sem rodar contra banco — a migration roda no boot do Railway; conferência manual: colunas×valores nos INSERTs, `IF NOT EXISTS` em tudo)

### Task 2: ApiConnectionStorage

**Files:**
- Create: `src/storages/ApiConnectionStorage.js`

- [ ] **Step 1: Escrever o storage**

```js
// src/storages/ApiConnectionStorage.js
// SQL puro das conexões de API (tokens pessoais) e da fila de webhook.

class ApiConnectionStorage {
  static async listForUser(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT id_connection, name, token_prefix, scope_personal, webhook_url,
              status, last_used_at, last_ip, created_at, revoked_at
         FROM public.tb_api_connection
        WHERE id_user = $1
        ORDER BY created_at DESC`,
      [id_user]
    );
    return rows;
  }

  static async countActiveForUser(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS c
         FROM public.tb_api_connection
        WHERE id_user = $1 AND status = 'active'`,
      [id_user]
    );
    return rows[0]?.c || 0;
  }

  static async create(conn, { id_user, name, token_hash, token_prefix, scope_personal, webhook_secret }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_api_connection
         (id_user, name, token_hash, token_prefix, scope_personal, webhook_secret)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id_connection, name, token_prefix, scope_personal, status, created_at`,
      [id_user, name, token_hash, token_prefix, scope_personal, webhook_secret]
    );
    return rows[0] || null;
  }

  static async getActiveByTokenHash(conn, token_hash) {
    const { rows } = await conn.query(
      `SELECT id_connection, id_user, name, scope_personal, webhook_url,
              webhook_secret, status, created_at
         FROM public.tb_api_connection
        WHERE token_hash = $1 AND status = 'active'`,
      [token_hash]
    );
    return rows[0] || null;
  }

  static async getByIdForUser(conn, { id_connection, id_user }) {
    const { rows } = await conn.query(
      `SELECT id_connection, id_user, name, status
         FROM public.tb_api_connection
        WHERE id_connection = $1 AND id_user = $2`,
      [id_connection, id_user]
    );
    return rows[0] || null;
  }

  static async revoke(conn, { id_connection, id_user }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_api_connection
          SET status = 'revoked', revoked_at = NOW()
        WHERE id_connection = $1 AND id_user = $2 AND status = 'active'
        RETURNING id_connection, status, revoked_at`,
      [id_connection, id_user]
    );
    return rows[0] || null;
  }

  // Touch com throttle embutido no SQL: só grava se o último uso for > 60s.
  static async touchLastUsed(conn, { id_connection, ip }) {
    await conn.query(
      `UPDATE public.tb_api_connection
          SET last_used_at = NOW(), last_ip = $2
        WHERE id_connection = $1
          AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '60 seconds')`,
      [id_connection, ip || null]
    );
  }

  static async setWebhookUrl(conn, { id_connection, webhook_url }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_api_connection
          SET webhook_url = $2
        WHERE id_connection = $1 AND status = 'active'
        RETURNING id_connection, webhook_url, webhook_secret`,
      [id_connection, webhook_url]
    );
    return rows[0] || null;
  }

  // ── Fila de webhook ────────────────────────────────────────────────────────
  static async enqueueDelivery(conn, { id_connection, event_type, payload }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_api_webhook_delivery (id_connection, event_type, payload)
       VALUES ($1, $2, $3::jsonb)
       RETURNING *`,
      [id_connection, event_type, JSON.stringify(payload)]
    );
    return rows[0] || null;
  }

  static async listDueDeliveries(conn, limit = 20) {
    const { rows } = await conn.query(
      `SELECT d.*, c.webhook_url, c.webhook_secret, c.status AS connection_status
         FROM public.tb_api_webhook_delivery d
         JOIN public.tb_api_connection c ON c.id_connection = d.id_connection
        WHERE d.status = 'pending' AND d.next_attempt_at <= NOW()
        ORDER BY d.next_attempt_at ASC
        LIMIT $1`,
      [limit]
    );
    return rows;
  }

  static async markDelivered(conn, id_delivery) {
    await conn.query(
      `UPDATE public.tb_api_webhook_delivery
          SET status = 'delivered', delivered_at = NOW()
        WHERE id_delivery = $1`,
      [id_delivery]
    );
  }

  static async scheduleRetry(conn, { id_delivery, attempts, next_attempt_at, last_error, failed }) {
    await conn.query(
      `UPDATE public.tb_api_webhook_delivery
          SET attempts = $2,
              next_attempt_at = $3,
              last_error = $4,
              status = CASE WHEN $5 THEN 'failed' ELSE 'pending' END
        WHERE id_delivery = $1`,
      [id_delivery, attempts, next_attempt_at, String(last_error || "").slice(0, 500), !!failed]
    );
  }
}

module.exports = ApiConnectionStorage;
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check src/storages/ApiConnectionStorage.js`
Expected: sem output (exit 0)

### Task 3: ApiConnectionService (geração de token)

**Files:**
- Create: `src/services/ApiConnectionService.js`

- [ ] **Step 1: Escrever o service**

```js
// src/services/ApiConnectionService.js
// Gestão das conexões de API do usuário (token pessoal do atendimento).
// O token em claro só existe na resposta do create — nunca é persistido.
const crypto = require("crypto");
const pool = require("../databases");
const ApiConnectionStorage = require("../storages/ApiConnectionStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ApiConnectionService");

const MAX_ACTIVE_CONNECTIONS = 3;
const TOKEN_PREFIX = "flnd_atd_";

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

class ApiConnectionService {
  static async list(user) {
    return runWithLogs(log, "list", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const connections = await ApiConnectionStorage.listForUser(pool, user.id_user);
      return { connections };
    });
  }

  static async create(user, body) {
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const name = String(body?.name || "").trim();
      if (name.length < 2 || name.length > 80) {
        return { error: "Nome da conexão precisa ter entre 2 e 80 caracteres" };
      }
      const scope_personal = body?.scope_personal === true;

      const active = await ApiConnectionStorage.countActiveForUser(pool, user.id_user);
      if (active >= MAX_ACTIVE_CONNECTIONS) {
        return { error: `Limite de ${MAX_ACTIVE_CONNECTIONS} conexões ativas atingido. Revogue uma para criar outra.` };
      }

      const token = TOKEN_PREFIX + crypto.randomBytes(24).toString("base64url");
      const webhook_secret = "flwh_" + crypto.randomBytes(24).toString("base64url");
      const created = await ApiConnectionStorage.create(pool, {
        id_user: user.id_user,
        name,
        token_hash: sha256Hex(token),
        token_prefix: token.slice(0, 14),
        scope_personal,
        webhook_secret,
      });
      if (!created) return { error: "Erro ao criar conexão" };

      // `token` sai UMA vez. O front avisa que não será mostrado de novo.
      return { connection: created, token };
    });
  }

  static async revoke(user, id_connection) {
    return runWithLogs(log, "revoke", () => ({ id_user: user?.id_user, id_connection }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const existing = await ApiConnectionStorage.getByIdForUser(pool, {
        id_connection,
        id_user: user.id_user,
      });
      if (!existing) return { error: "Conexão não encontrada" };
      if (existing.status === "revoked") return { error: "Conexão já revogada" };
      const revoked = await ApiConnectionStorage.revoke(pool, {
        id_connection,
        id_user: user.id_user,
      });
      return { connection: revoked };
    });
  }
}

ApiConnectionService.sha256Hex = sha256Hex;
ApiConnectionService.TOKEN_PREFIX = TOKEN_PREFIX;

module.exports = ApiConnectionService;
```

**Nota:** confira como `runWithLogs` é exportado — nos services existentes o import é `const { createLogger } = require("../utils/logger")` e `runWithLogs` vem de onde `ConversationService.js` importa (copiar o import EXATO do topo de `src/services/ConversationService.js`; se `runWithLogs` vier de `../utils/runWithLogs`, ajustar).

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check src/services/ApiConnectionService.js`
Expected: exit 0

### Task 4: Controller + rotas `/me/api-connections`

**Files:**
- Create: `src/controllers/ApiConnectionController.js`
- Create: `src/routes/apiConnection.routes.js`
- Modify: `src/routes/index.js`

- [ ] **Step 1: Controller**

```js
// src/controllers/ApiConnectionController.js
const ApiConnectionService = require("../services/ApiConnectionService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ApiConnectionController {
  static async list(req, res) {
    const result = await ApiConnectionService.list(req.user);
    return sendServiceResult(res, result);
  }

  static async create(req, res) {
    const result = await ApiConnectionService.create(req.user, req.body);
    return sendServiceResult(res, result, 201);
  }

  static async revoke(req, res) {
    const result = await ApiConnectionService.revoke(req.user, req.params.id);
    return sendServiceResult(res, result);
  }
}

module.exports = ApiConnectionController;
```

- [ ] **Step 2: Rotas**

```js
// src/routes/apiConnection.routes.js
// Gestão das conexões de API (token do atendimento) — JWT normal do site.
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const ApiConnectionController = require("../controllers/ApiConnectionController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(requireFeature("atendimento_api"));

router.get("/", authMiddleware, asyncHandler(ApiConnectionController.list));
router.post("/", authMiddleware, asyncHandler(ApiConnectionController.create));
router.post("/:id/revoke", authMiddleware, asyncHandler(ApiConnectionController.revoke));

module.exports = router;
```

- [ ] **Step 3: Montar em `src/routes/index.js`** — junto dos outros requires (perto da linha 45 onde está `conversationRoutes`):

```js
const apiConnectionRoutes = require("./apiConnection.routes");
```

e junto dos `app.use` de `/me/*` (perto da linha 187):

```js
  app.use("/me/api-connections", apiConnectionRoutes);
```

- [ ] **Step 4: Verificar**

Run: `node --check src/controllers/ApiConnectionController.js; node --check src/routes/apiConnection.routes.js; node --check src/routes/index.js`
Expected: exit 0 nos três

### Task 5: Middleware `apiConnectionAuth` + rate limit

**Files:**
- Create: `src/middlewares/apiConnectionAuth.js`
- Create: `src/middlewares/extRateLimit.js`

- [ ] **Step 1: Auth por token de conexão**

```js
// src/middlewares/apiConnectionAuth.js
// Autentica requests do /ext/v1 pelo token pessoal (Bearer flnd_atd_...).
// Injeta req.apiConnection e req.user (o DONO da conexão) — os services
// internos reusados (ConversationService etc.) enxergam o dono normalmente.
const pool = require("../databases");
const ApiConnectionStorage = require("../storages/ApiConnectionStorage");
const ApiConnectionService = require("../services/ApiConnectionService");
const { createLogger } = require("../utils/logger");

const log = createLogger("apiConnectionAuth");

async function apiConnectionAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [, token] = header.split(" ");
  if (!token || !token.startsWith(ApiConnectionService.TOKEN_PREFIX)) {
    return res.status(401).json({ error: "Token de API não informado ou inválido" });
  }
  try {
    const connection = await ApiConnectionStorage.getActiveByTokenHash(
      pool,
      ApiConnectionService.sha256Hex(token)
    );
    if (!connection) {
      return res.status(401).json({ error: "Token de API inválido ou revogado" });
    }
    req.apiConnection = connection;
    req.user = { id_user: connection.id_user };
    // Auditoria best-effort (throttle de 60s embutido no SQL).
    ApiConnectionStorage.touchLastUsed(pool, {
      id_connection: connection.id_connection,
      ip: req.ip,
    }).catch(() => {});
    return next();
  } catch (err) {
    log.error("auth_error", { message: err?.message });
    return res.status(500).json({ error: "Erro ao autenticar" });
  }
}

module.exports = apiConnectionAuth;
```

- [ ] **Step 2: Rate limit em memória por conexão** (60 req/min; suficiente para 1 instância Railway)

```js
// src/middlewares/extRateLimit.js
// Limite simples por conexão: 60 requests/minuto (janela fixa, em memória).
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 60;
const buckets = new Map(); // id_connection -> { count, windowStart }

function extRateLimit(req, res, next) {
  const key = req.apiConnection?.id_connection || req.ip;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS) {
    res.set("Retry-After", String(Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000)));
    return res.status(429).json({ error: "Limite de requisições excedido (60/min)" });
  }
  return next();
}

// GC ocasional pra Map não crescer indefinidamente.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < cutoff) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref?.();

module.exports = extRateLimit;
```

- [ ] **Step 3: Verificar**

Run: `node --check src/middlewares/apiConnectionAuth.js; node --check src/middlewares/extRateLimit.js`
Expected: exit 0

- [ ] **Step 4: Commit do Slice 1**

```bash
git add src/databases/migrations/171_api_connections.sql src/storages/ApiConnectionStorage.js src/services/ApiConnectionService.js src/controllers/ApiConnectionController.js src/routes/apiConnection.routes.js src/routes/index.js src/middlewares/apiConnectionAuth.js src/middlewares/extRateLimit.js
git commit -m "feat(atendimento-api): slice 1 — migration 171 + CRUD /me/api-connections + auth por token"
```

(Antes do commit: `npm run lint` — max-warnings 0.)

---

## SLICE 2 — `/ext/v1` (leitura + resposta unificada dm/os)

### Task 6: `sent_via` nos dois fluxos de mensagem

**Files:**
- Modify: `src/storages/MessageStorage.js:42-58` (método `create`)
- Modify: `src/storages/ServiceRequestStorage.js:498-517` (`listMessages` e `createMessage`)
- Modify: `src/services/ConversationService.js` (`sendMessage` linha ~338, `listMessages` linha ~308, `mapMessage` linha ~53)
- Modify: `src/services/ServiceRequestService.js` (`sendMessage` linha ~369, `listMessages` linha ~357)

- [ ] **Step 1: `MessageStorage.create` ganha `sent_via`** — trocar o método atual por:

```js
  static async create(conn, { id_conversation, sender_entity_id, sender_user_id, body, sent_via = "app" }) {
    const { rows } = await conn.query(
      `
      INSERT INTO public.tb_message (
        id_conversation,
        sender_entity_type, sender_entity_id,
        sender_user_id,
        body,
        kind,
        sent_via
      )
      VALUES ($1, 'profile', $2, $3, $4, 'text', $5)
      RETURNING *
      `,
      [id_conversation, sender_entity_id, sender_user_id, body, sent_via]
    );
    return rows[0] || null;
  }
```

- [ ] **Step 2: `ServiceRequestStorage`** — `listMessages` passa a selecionar `sent_via`; `createMessage` ganha o campo:

```js
  static async listMessages(conn, id_response) {
    const r = await conn.query(
      `SELECT id_message, id_response, sender, content, sent_via, created_at
         FROM public.tb_service_request_message
        WHERE id_response = $1
        ORDER BY created_at ASC`,
      [id_response]
    );
    return r.rows;
  }

  static async createMessage(conn, { id_response, sender, content, sent_via = "app" }) {
    const r = await conn.query(
      `INSERT INTO public.tb_service_request_message (id_response, sender, content, sent_via)
       VALUES ($1, $2, $3, $4)
       RETURNING id_message, id_response, sender, content, sent_via, created_at`,
      [id_response, sender, content, sent_via]
    );
    return r.rows[0];
  }
```

- [ ] **Step 3: `ConversationService`** — três pontos:

(a) `mapMessage` (linha ~53): adicionar ao objeto retornado, junto de `kind`:

```js
    sent_via: row.sent_via || "app",
```

(b) `sendMessage`: mudar a assinatura de `static async sendMessage(user, payload) {` para `static async sendMessage(user, payload, opts = {}) {` e na chamada `MessageStorage.create` (linha ~422) acrescentar o campo:

```js
          const message = await MessageStorage.create(client, {
            id_conversation: conv.id_conversation,
            sender_entity_id: actorRes.actor_id,
            sender_user_id: user.id_user,
            body,
            sent_via: opts.sent_via === "api" ? "api" : "app",
          });
```

(`opts` NUNCA vem do body HTTP — só o ExtMessagingService passa `{ sent_via: "api" }`. Controllers internos não mudam.)

(c) `listMessages` (linha ~329): esconder `sent_via` das mensagens do OUTRO lado (selo é só do dono):

```js
        return {
          items: result.items.map((m) => {
            const mapped = mapMessage(m);
            if (String(m.sender_user_id) !== String(user.id_user)) delete mapped.sent_via;
            return mapped;
          }),
          next_cursor: result.next_cursor,
          has_more: result.has_more,
        };
```

- [ ] **Step 4: `ServiceRequestService`** — dois pontos:

(a) `sendMessage`: assinatura `static async sendMessage(user, id_response, body, opts = {}) {` e a chamada de `createMessage`:

```js
      const msg = await ServiceRequestStorage.createMessage(pool, {
        id_response,
        sender: ctx.side,
        content,
        sent_via: opts.sent_via === "api" ? "api" : "app",
      });
```

(b) `listMessages` (linha ~363): trocar `return { messages, side: ctx.side, response: ctx.response };` por:

```js
      return {
        messages: messages.map((m) => ({
          ...m,
          sent_via: m.sender === ctx.side ? m.sent_via || "app" : undefined,
        })),
        side: ctx.side,
        response: ctx.response,
      };
```

- [ ] **Step 5: Verificar**

Run: `node --check src/storages/MessageStorage.js; node --check src/storages/ServiceRequestStorage.js; node --check src/services/ConversationService.js; node --check src/services/ServiceRequestService.js`
Expected: exit 0 nos quatro

### Task 7: ExtMessagingStorage (predicado de escopo)

**Files:**
- Create: `src/storages/ExtMessagingStorage.js`

- [ ] **Step 1: Escrever o storage.** Escopo DM: conversa `direct` onde um lado é perfil do dono (não-clan, não-comunidade) E (`scope_personal` OU criada após a conexão). Escopo O.S.: response cujo `id_profile` pertence ao dono (lado PRO), status ativo.

```js
// src/storages/ExtMessagingStorage.js
// Consultas de ESCOPO da API de Atendimento. Uma conversa está no alcance de
// uma conexão se: (O.S. do dono, sempre) OU (direta criada após a conexão) OU
// (scope_personal=TRUE → qualquer direta do dono). Grupos/clans/comunidades
// ficam fora em qualquer caso.

class ExtMessagingStorage {
  static async listDmInScope(conn, { id_user, scope_personal, connected_at, updated_since, limit }) {
    const { rows } = await conn.query(
      `
      SELECT * FROM (
        SELECT DISTINCT ON (c.id_conversation)
          c.id_conversation, c.created_at, c.last_message_at, c.last_message_preview,
          my.id_profile   AS my_profile_id,
          other.id_profile AS other_profile_id,
          other.display_name AS other_display_name,
          other.avatar_url   AS other_avatar_url,
          other.sub_profile_slug AS other_sub_profile_slug,
          ou.username        AS other_username
          FROM public.tb_conversation c
          JOIN public.tb_profile my
            ON my.id_profile IN (c.entity_a_id, c.entity_b_id)
           AND my.id_user = $1
           AND my.is_clan = FALSE
           AND COALESCE(my.is_community, FALSE) = FALSE
           AND my.deleted_at IS NULL
          JOIN public.tb_profile other
            ON other.id_profile = CASE WHEN c.entity_a_id = my.id_profile
                                       THEN c.entity_b_id ELSE c.entity_a_id END
          LEFT JOIN public.tb_user ou ON ou.id_user = other.id_user
         WHERE c.kind = 'direct'
           AND c.deleted_at IS NULL
           AND ($2::boolean OR c.created_at >= $3::timestamptz)
         ORDER BY c.id_conversation, my.created_at ASC
      ) scoped
      WHERE ($4::timestamptz IS NULL OR GREATEST(COALESCE(scoped.last_message_at, scoped.created_at), scoped.created_at) >= $4::timestamptz)
      ORDER BY COALESCE(scoped.last_message_at, scoped.created_at) DESC
      LIMIT $5
      `,
      [id_user, !!scope_personal, connected_at, updated_since || null, limit]
    );
    return rows;
  }

  static async getDmInScope(conn, { id_conversation, id_user, scope_personal, connected_at }) {
    const { rows } = await conn.query(
      `
      SELECT c.id_conversation, c.created_at, my.id_profile AS my_profile_id
        FROM public.tb_conversation c
        JOIN public.tb_profile my
          ON my.id_profile IN (c.entity_a_id, c.entity_b_id)
         AND my.id_user = $2
         AND my.is_clan = FALSE
         AND COALESCE(my.is_community, FALSE) = FALSE
         AND my.deleted_at IS NULL
       WHERE c.id_conversation = $1
         AND c.kind = 'direct'
         AND c.deleted_at IS NULL
         AND ($3::boolean OR c.created_at >= $4::timestamptz)
       ORDER BY my.created_at ASC
       LIMIT 1
      `,
      [id_conversation, id_user, !!scope_personal, connected_at]
    );
    return rows[0] || null;
  }

  static async listOsInScope(conn, { id_user, updated_since, limit }) {
    const { rows } = await conn.query(
      `
      SELECT resp.id_response, resp.id_request, resp.status, resp.created_at,
             req.description, req.estado, req.municipio,
             bu.username AS buyer_username,
             p.id_profile AS my_profile_id,
             p.display_name AS my_profile_name,
             lm.content    AS last_message_preview,
             lm.created_at AS last_message_at
        FROM public.tb_service_request_response resp
        JOIN public.tb_profile p
          ON p.id_profile = resp.id_profile AND p.id_user = $1 AND p.deleted_at IS NULL
        JOIN public.tb_service_request req ON req.id_request = resp.id_request
        JOIN public.tb_user bu ON bu.id_user = req.id_user
        LEFT JOIN LATERAL (
          SELECT content, created_at
            FROM public.tb_service_request_message
           WHERE id_response = resp.id_response
           ORDER BY created_at DESC LIMIT 1
        ) lm ON TRUE
       WHERE resp.status IN ('PENDING','PRO_ACCEPTED')
         AND ($2::timestamptz IS NULL OR COALESCE(lm.created_at, resp.created_at) >= $2::timestamptz)
       ORDER BY COALESCE(lm.created_at, resp.created_at) DESC
       LIMIT $3
      `,
      [id_user, updated_since || null, limit]
    );
    return rows;
  }

  static async getOsInScope(conn, { id_response, id_user }) {
    const { rows } = await conn.query(
      `
      SELECT resp.id_response, resp.status
        FROM public.tb_service_request_response resp
        JOIN public.tb_profile p
          ON p.id_profile = resp.id_profile AND p.id_user = $2 AND p.deleted_at IS NULL
       WHERE resp.id_response = $1
      `,
      [id_response, id_user]
    );
    return rows[0] || null;
  }

  static async getUserBasic(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT id_user, username, email FROM public.tb_user WHERE id_user = $1`,
      [id_user]
    );
    return rows[0] || null;
  }

  static async getProfileBrief(conn, id_profile) {
    const { rows } = await conn.query(
      `SELECT p.id_profile, p.display_name, p.sub_profile_slug, u.username
         FROM public.tb_profile p
         LEFT JOIN public.tb_user u ON u.id_user = p.id_user
        WHERE p.id_profile = $1`,
      [id_profile]
    );
    return rows[0] || null;
  }
}

module.exports = ExtMessagingStorage;
```

- [ ] **Step 2: Verificar**

Run: `node --check src/storages/ExtMessagingStorage.js`
Expected: exit 0

### Task 8: ExtMessagingService + Controller + rotas `/ext/v1`

**Files:**
- Create: `src/services/ExtMessagingService.js`
- Create: `src/controllers/ExtMessagingController.js`
- Create: `src/routes/ext.routes.js`
- Modify: `src/routes/index.js`

- [ ] **Step 1: Service.** Ids externos `dm:<uuid>` / `os:<uuid>`. Delega nos services internos (moderação/supervisão/rate-limit de graça).

```js
// src/services/ExtMessagingService.js
// Camada externa da API de Atendimento: traduz ids unificados (dm:/os:) e
// delega nos services internos. NUNCA abre conversa (só responde) — decisão
// do spec 2026-07-02.
const pool = require("../databases");
const ExtMessagingStorage = require("../storages/ExtMessagingStorage");
const ApiConnectionStorage = require("../storages/ApiConnectionStorage");
const ConversationService = require("./ConversationService");
const ServiceRequestService = require("./ServiceRequestService");
const { validateWebhookUrl } = require("../utils/webhookUrl");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ExtMessagingService");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseExtId(raw) {
  const [type, id] = String(raw || "").split(":");
  if (!["dm", "os"].includes(type) || !UUID_RE.test(id || "")) return null;
  return { type, id };
}

function ownerUser(connection) {
  return { id_user: connection.id_user };
}

class ExtMessagingService {
  static async me(connection) {
    return runWithLogs(log, "me", () => ({ id_connection: connection?.id_connection }), async () => {
      const user = await ExtMessagingStorage.getUserBasic(pool, connection.id_user);
      return {
        connection: {
          id_connection: connection.id_connection,
          name: connection.name,
          scope_personal: connection.scope_personal,
          webhook_url: connection.webhook_url,
          created_at: connection.created_at,
        },
        user: user ? { id_user: user.id_user, username: user.username } : null,
      };
    });
  }

  static async setWebhook(connection, body) {
    return runWithLogs(log, "setWebhook", () => ({ id_connection: connection?.id_connection }), async () => {
      const url = String(body?.url || "").trim();
      const check = await validateWebhookUrl(url);
      if (check.error) return check;
      const updated = await ApiConnectionStorage.setWebhookUrl(pool, {
        id_connection: connection.id_connection,
        webhook_url: url,
      });
      if (!updated) return { error: "Conexão inativa" };
      return { webhook_url: updated.webhook_url, webhook_secret: updated.webhook_secret };
    });
  }

  static async listConversations(connection, query) {
    return runWithLogs(log, "listConversations", () => ({ id_connection: connection?.id_connection }), async () => {
      const limit = Math.min(Math.max(parseInt(query?.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      let updated_since = null;
      if (query?.updated_since) {
        const d = new Date(query.updated_since);
        if (Number.isNaN(d.getTime())) return { error: "updated_since inválido (use ISO 8601)" };
        updated_since = d.toISOString();
      }
      const [dms, oss] = await Promise.all([
        ExtMessagingStorage.listDmInScope(pool, {
          id_user: connection.id_user,
          scope_personal: connection.scope_personal,
          connected_at: connection.created_at,
          updated_since,
          limit,
        }),
        ExtMessagingStorage.listOsInScope(pool, {
          id_user: connection.id_user,
          updated_since,
          limit,
        }),
      ]);
      const items = [
        ...dms.map((r) => ({
          id: `dm:${r.id_conversation}`,
          type: "dm",
          created_at: r.created_at,
          last_message_at: r.last_message_at,
          last_message_preview: r.last_message_preview,
          my_profile_id: r.my_profile_id,
          counterpart: {
            id_profile: r.other_profile_id,
            display_name: r.other_display_name,
            username: r.other_username,
            sub_profile_slug: r.other_sub_profile_slug,
            avatar_url: r.other_avatar_url,
          },
        })),
        ...oss.map((r) => ({
          id: `os:${r.id_response}`,
          type: "os",
          status: r.status,
          created_at: r.created_at,
          last_message_at: r.last_message_at,
          last_message_preview: r.last_message_preview,
          my_profile_id: r.my_profile_id,
          request: { id_request: r.id_request, description: r.description, estado: r.estado, municipio: r.municipio },
          counterpart: { username: r.buyer_username },
        })),
      ].sort((a, b) => {
        const ta = new Date(a.last_message_at || a.created_at).getTime();
        const tb = new Date(b.last_message_at || b.created_at).getTime();
        return tb - ta;
      });
      return { items: items.slice(0, limit) };
    });
  }

  static async _resolveScoped(connection, rawId) {
    const parsed = parseExtId(rawId);
    if (!parsed) return { error: "id de conversa inválido (use dm:<uuid> ou os:<uuid>)" };
    if (parsed.type === "dm") {
      const row = await ExtMessagingStorage.getDmInScope(pool, {
        id_conversation: parsed.id,
        id_user: connection.id_user,
        scope_personal: connection.scope_personal,
        connected_at: connection.created_at,
      });
      if (!row) return { error: "Conversa fora do escopo desta conexão", status: 403 };
      return { type: "dm", id: parsed.id, my_profile_id: row.my_profile_id };
    }
    const row = await ExtMessagingStorage.getOsInScope(pool, {
      id_response: parsed.id,
      id_user: connection.id_user,
    });
    if (!row) return { error: "Conversa fora do escopo desta conexão", status: 403 };
    return { type: "os", id: parsed.id };
  }

  static async listMessages(connection, rawId, query) {
    return runWithLogs(log, "listMessages", () => ({ id_connection: connection?.id_connection, rawId }), async () => {
      const scoped = await this._resolveScoped(connection, rawId);
      if (scoped.error) return scoped;
      if (scoped.type === "dm") {
        return ConversationService.listMessages(ownerUser(connection), {
          id_conversation: scoped.id,
          actor_id: scoped.my_profile_id,
          actor_type: "profile",
          cursor: query?.cursor,
          limit: query?.limit,
        });
      }
      return ServiceRequestService.listMessages(ownerUser(connection), scoped.id);
    });
  }

  static async sendMessage(connection, rawId, body) {
    return runWithLogs(log, "sendMessage", () => ({ id_connection: connection?.id_connection, rawId }), async () => {
      const text = String(body?.body || body?.content || "").trim();
      if (!text) return { error: "Mensagem não pode ser vazia" };
      const scoped = await this._resolveScoped(connection, rawId);
      if (scoped.error) return scoped;
      if (scoped.type === "dm") {
        return ConversationService.sendMessage(
          ownerUser(connection),
          {
            id_conversation: scoped.id,
            actor_id: scoped.my_profile_id,
            actor_type: "profile",
            body: text,
          },
          { sent_via: "api" }
        );
      }
      return ServiceRequestService.sendMessage(
        ownerUser(connection),
        scoped.id,
        { content: text },
        { sent_via: "api" }
      );
    });
  }

  static async markRead(connection, rawId) {
    return runWithLogs(log, "markRead", () => ({ id_connection: connection?.id_connection, rawId }), async () => {
      const scoped = await this._resolveScoped(connection, rawId);
      if (scoped.error) return scoped;
      if (scoped.type === "dm") {
        return ConversationService.markRead(ownerUser(connection), {
          id_conversation: scoped.id,
          actor_id: scoped.my_profile_id,
          actor_type: "profile",
        });
      }
      return ServiceRequestService.markRead(ownerUser(connection), scoped.id);
    });
  }
}

module.exports = ExtMessagingService;
```

**Atenção (verificado no código):** `ConversationService.sendMessage` faz rate-limit e supervisão pelo `user.id_user` — funciona com `{ id_user }` puro. `ServiceRequestService.listMessages` também marca como lida (comportamento igual ao site — documentar na Task 15).

- [ ] **Step 2: Controller**

```js
// src/controllers/ExtMessagingController.js
const ExtMessagingService = require("../services/ExtMessagingService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ExtMessagingController {
  static async me(req, res) {
    const result = await ExtMessagingService.me(req.apiConnection);
    return sendServiceResult(res, result);
  }

  static async setWebhook(req, res) {
    const result = await ExtMessagingService.setWebhook(req.apiConnection, req.body);
    return sendServiceResult(res, result);
  }

  static async listConversations(req, res) {
    const result = await ExtMessagingService.listConversations(req.apiConnection, req.query);
    return sendServiceResult(res, result);
  }

  static async listMessages(req, res) {
    const result = await ExtMessagingService.listMessages(req.apiConnection, req.params.id, req.query);
    return sendServiceResult(res, result);
  }

  static async sendMessage(req, res) {
    const result = await ExtMessagingService.sendMessage(req.apiConnection, req.params.id, req.body);
    return sendServiceResult(res, result, 201);
  }

  static async markRead(req, res) {
    const result = await ExtMessagingService.markRead(req.apiConnection, req.params.id);
    return sendServiceResult(res, result);
  }
}

module.exports = ExtMessagingController;
```

- [ ] **Step 3: Rotas**

```js
// src/routes/ext.routes.js
// API externa de atendimento (/ext/v1). Auth por token de conexão, NÃO JWT.
const { Router } = require("express");
const requireFeature = require("../middlewares/requireFeature");
const apiConnectionAuth = require("../middlewares/apiConnectionAuth");
const extRateLimit = require("../middlewares/extRateLimit");
const ExtMessagingController = require("../controllers/ExtMessagingController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(requireFeature("atendimento_api"));
router.use(apiConnectionAuth);
router.use(extRateLimit);

router.get("/me", asyncHandler(ExtMessagingController.me));
router.post("/webhook", asyncHandler(ExtMessagingController.setWebhook));
router.get("/conversations", asyncHandler(ExtMessagingController.listConversations));
router.get("/conversations/:id/messages", asyncHandler(ExtMessagingController.listMessages));
router.post("/conversations/:id/messages", asyncHandler(ExtMessagingController.sendMessage));
router.post("/conversations/:id/read", asyncHandler(ExtMessagingController.markRead));

module.exports = router;
```

- [ ] **Step 4: Montar em `src/routes/index.js`**: require `const extRoutes = require("./ext.routes");` + mount `app.use("/ext/v1", extRoutes);` (junto dos outros mounts de topo, ex. depois de `/conversations`).

- [ ] **Step 5: Verificar sintaxe dos 4 arquivos + lint**

Run: `node --check src/services/ExtMessagingService.js; node --check src/controllers/ExtMessagingController.js; node --check src/routes/ext.routes.js; node --check src/routes/index.js; npm run lint`
Expected: exit 0

**Nota:** `src/utils/webhookUrl.js` só nasce na Task 9 (Slice 3) — para commitar o Slice 2 sem quebrar o boot, criar o util JÁ nesta task (ele é pequeno e não depende de nada do Slice 3). Ver código na Task 9 Step 1 e criá-lo aqui.

- [ ] **Step 6: Commit do Slice 2**

```bash
git add src/storages/MessageStorage.js src/storages/ServiceRequestStorage.js src/services/ConversationService.js src/services/ServiceRequestService.js src/storages/ExtMessagingStorage.js src/services/ExtMessagingService.js src/controllers/ExtMessagingController.js src/routes/ext.routes.js src/routes/index.js src/utils/webhookUrl.js
git commit -m "feat(atendimento-api): slice 2 — /ext/v1 unificado (dm:/os:) + sent_via nos dois fluxos"
```

---

## SLICE 3 — Webhook push (dispatch + retry + HMAC + anti-SSRF)

### Task 9: util anti-SSRF (`webhookUrl.js`)

**Files:**
- Create: `src/utils/webhookUrl.js` (se ainda não criado na Task 8 Step 5)

- [ ] **Step 1: Escrever o util**

```js
// src/utils/webhookUrl.js
// Validação anti-SSRF da URL de webhook: HTTPS obrigatório e destino não pode
// resolver para IP privado/loopback/link-local. ALLOW_INSECURE_WEBHOOK=1
// libera http/localhost SÓ para dev local (simulador).
const dns = require("dns").promises;
const net = require("net");

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7)); // IPv4-mapped
  return false;
}

async function validateWebhookUrl(raw) {
  const allowInsecure = process.env.ALLOW_INSECURE_WEBHOOK === "1";
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    return { error: "URL de webhook inválida" };
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    return { error: "Webhook precisa ser http(s)" };
  }
  if (url.protocol !== "https:" && !allowInsecure) {
    return { error: "Webhook precisa ser HTTPS" };
  }
  if (allowInsecure) return { ok: true };
  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch {
    return { error: "Host do webhook não resolve" };
  }
  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) {
    return { error: "Webhook não pode apontar para rede privada" };
  }
  return { ok: true };
}

module.exports = { validateWebhookUrl, isPrivateIp };
```

- [ ] **Step 2: Verificar**

Run: `node --check src/utils/webhookUrl.js`
Expected: exit 0

### Task 10: WebhookDispatchService (fila + entrega + sweeper)

**Files:**
- Create: `src/services/WebhookDispatchService.js`

- [ ] **Step 1: Escrever o service**

```js
// src/services/WebhookDispatchService.js
// Entrega de webhooks da API de Atendimento. Evento v1: message.received.
// Enfileira em tb_api_webhook_delivery, tenta na hora e re-tenta com backoff
// via sweeper (60s). Assinatura: X-Freelandoo-Signature = sha256=HMAC(secret,
// `${timestamp}.${body}`) — timestamp junto evita replay (amenda o spec, que
// dizia HMAC só do body).
const crypto = require("crypto");
const pool = require("../databases");
const ApiConnectionStorage = require("../storages/ApiConnectionStorage");
const ExtMessagingStorage = require("../storages/ExtMessagingStorage");
const { createLogger } = require("../utils/logger");

const log = createLogger("WebhookDispatchService");

const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000];
const MAX_ATTEMPTS = BACKOFF_MS.length; // 5
const DELIVER_TIMEOUT_MS = 10_000;

function sign(secret, timestamp, body) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

async function postWebhook({ url, secret, payload }) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Freelandoo-Timestamp": timestamp,
      "X-Freelandoo-Signature": `sha256=${sign(secret, timestamp, body)}`,
      "User-Agent": "Freelandoo-Webhook/1.0",
    },
    body,
    signal: AbortSignal.timeout(DELIVER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function attemptDelivery(delivery, { webhook_url, webhook_secret }) {
  try {
    await postWebhook({ url: webhook_url, secret: webhook_secret, payload: delivery.payload });
    await ApiConnectionStorage.markDelivered(pool, delivery.id_delivery);
  } catch (err) {
    const attempts = (delivery.attempts || 0) + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    const next = new Date(Date.now() + (BACKOFF_MS[attempts - 1] || BACKOFF_MS.at(-1)));
    await ApiConnectionStorage.scheduleRetry(pool, {
      id_delivery: delivery.id_delivery,
      attempts,
      next_attempt_at: next,
      last_error: err?.message,
      failed,
    }).catch(() => {});
    if (failed) log.warn("delivery.failed", { id_delivery: delivery.id_delivery, attempts });
  }
}

async function enqueueForConnections(connections, payloadBuilder) {
  for (const c of connections) {
    try {
      const payload = payloadBuilder(c);
      const delivery = await ApiConnectionStorage.enqueueDelivery(pool, {
        id_connection: c.id_connection,
        event_type: "message.received",
        payload,
      });
      if (delivery) {
        // Entrega imediata fora do request path.
        setImmediate(() => {
          attemptDelivery(delivery, c).catch(() => {});
        });
      }
    } catch (err) {
      log.error("enqueue_error", { id_connection: c.id_connection, message: err?.message });
    }
  }
}

async function listActiveConnectionsWithWebhook(id_user) {
  const { rows } = await pool.query(
    `SELECT id_connection, id_user, scope_personal, webhook_url, webhook_secret, created_at
       FROM public.tb_api_connection
      WHERE id_user = $1 AND status = 'active' AND webhook_url IS NOT NULL`,
    [id_user]
  );
  return rows;
}

class WebhookDispatchService {
  /**
   * Mensagem direta (tb_message) recebida: dispara para as conexões do DONO
   * do lado receptor cujo escopo cobre a conversa. Chamado fire-and-forget
   * pelo ConversationService.sendMessage — nunca lança pro caller.
   */
  static async onDirectMessage({ conversation, message, senderProfileId, recipientProfile, recipientUserId }) {
    if ((conversation.kind || "direct") !== "direct") return;
    if (recipientProfile?.is_clan || recipientProfile?.is_community) return;
    const connections = await listActiveConnectionsWithWebhook(recipientUserId);
    const inScope = connections.filter(
      (c) => c.scope_personal || new Date(conversation.created_at) >= new Date(c.created_at)
    );
    if (!inScope.length) return;
    const sender = await ExtMessagingStorage.getProfileBrief(pool, senderProfileId).catch(() => null);
    await enqueueForConnections(inScope, () => ({
      event: "message.received",
      created_at: new Date().toISOString(),
      conversation: {
        id: `dm:${conversation.id_conversation}`,
        type: "dm",
        created_at: conversation.created_at,
      },
      message: {
        id_message: message.id_message,
        body: message.body,
        kind: message.kind || "text",
        audio_url: message.audio_url || null,
        created_at: message.created_at,
        sender: sender
          ? { id_profile: sender.id_profile, display_name: sender.display_name, username: sender.username }
          : { id_profile: senderProfileId },
      },
    }));
  }

  /**
   * Mensagem de O.S. (tb_service_request_message) enviada pelo COMPRADOR:
   * dispara para as conexões do dono do lado PRO (O.S. sempre no escopo).
   */
  static async onOsMessage({ id_response, request, response, message, recipientUserId }) {
    const connections = await listActiveConnectionsWithWebhook(recipientUserId);
    if (!connections.length) return;
    await enqueueForConnections(connections, () => ({
      event: "message.received",
      created_at: new Date().toISOString(),
      conversation: {
        id: `os:${id_response}`,
        type: "os",
        status: response?.status,
        request: {
          id_request: request?.id_request,
          description: request?.description,
          estado: request?.estado,
          municipio: request?.municipio,
        },
      },
      message: {
        id_message: message.id_message,
        body: message.content,
        kind: "text",
        created_at: message.created_at,
        sender: { side: "USER" },
      },
    }));
  }

  /** Sweeper de retry — chamar UMA vez no boot (index.js). */
  static startSweeper() {
    const tick = async () => {
      try {
        const due = await ApiConnectionStorage.listDueDeliveries(pool, 20);
        for (const d of due) {
          if (d.connection_status !== "active" || !d.webhook_url) {
            await ApiConnectionStorage.scheduleRetry(pool, {
              id_delivery: d.id_delivery,
              attempts: d.attempts,
              next_attempt_at: new Date(),
              last_error: "conexão revogada ou sem webhook",
              failed: true,
            });
            continue;
          }
          await attemptDelivery(d, d);
        }
      } catch (err) {
        log.error("sweeper_error", { message: err?.message });
      }
    };
    setTimeout(tick, 30 * 1000).unref?.();
    setInterval(tick, 60 * 1000).unref?.();
    log.info("sweeper.scheduled", { interval_s: 60 });
  }
}

module.exports = WebhookDispatchService;
```

(Node 18+ tem `fetch` e `AbortSignal.timeout` globais — o backend já usa Node moderno no Railway.)

- [ ] **Step 2: Verificar**

Run: `node --check src/services/WebhookDispatchService.js`
Expected: exit 0

### Task 11: Hooks nos dois fluxos + sweeper no boot

**Files:**
- Modify: `src/services/ConversationService.js` (`sendMessage`, após o bloco de notificação fire-and-forget, ~linha 529, antes do `return`)
- Modify: `src/services/ServiceRequestService.js` (`sendMessage`, após o bloco realtime, ~linha 409, antes do `return { message: msg }`)
- Modify: `index.js` (raiz do backend)

- [ ] **Step 1: Hook no `ConversationService.sendMessage`.** Adicionar import no topo do arquivo: `const WebhookDispatchService = require("./WebhookDispatchService");`. Depois do bloco de notificação (o `try/catch` que termina na linha ~529 com `/* fire-and-forget */`), inserir:

```js
          // Webhook da API de Atendimento (fire-and-forget): empurra a mensagem
          // pras conexões ativas do DONO do lado receptor, se a conversa estiver
          // no escopo (direta nova ou scope_personal). Anti-loop: só o receptor
          // recebe evento — quem enviou (app ou api) nunca recebe eco.
          try {
            if ((conv.kind || "direct") === "direct") {
              const whOtherId = await ConversationStorage.otherEntityId(conv, actorRes.actor_id);
              if (whOtherId) {
                const whProfile = await ProfileStorage.getProfileById(pool, whOtherId);
                if (whProfile?.id_user && whProfile.id_user !== user.id_user) {
                  WebhookDispatchService.onDirectMessage({
                    conversation: conv,
                    message,
                    senderProfileId: actorRes.actor_id,
                    recipientProfile: whProfile,
                    recipientUserId: whProfile.id_user,
                  }).catch(() => {});
                }
              }
            }
          } catch {
            /* fire-and-forget */
          }
```

- [ ] **Step 2: Hook no `ServiceRequestService.sendMessage`.** Import no topo: `const WebhookDispatchService = require("./WebhookDispatchService");`. Depois do bloco realtime (`} catch { /* realtime é best-effort */ }`, linha ~409) e antes de `return { message: msg };`:

```js
      // Webhook da API de Atendimento: O.S. está SEMPRE no escopo do vendedor.
      // Só dispara quando o COMPRADOR (USER) fala — resposta do PRO não gera evento.
      try {
        if (ctx.side === "USER") {
          const whProProfile = await ProfileStorage.getProfileById(pool, ctx.response.id_profile);
          if (whProProfile?.id_user) {
            WebhookDispatchService.onOsMessage({
              id_response,
              request: ctx.request,
              response: ctx.response,
              message: msg,
              recipientUserId: whProProfile.id_user,
            }).catch(() => {});
          }
        }
      } catch {
        /* fire-and-forget */
      }
```

- [ ] **Step 3: Sweeper no boot.** Em `index.js` (raiz), logo após `startMediaWorker();` (linha ~27):

```js
  // Webhook da API de Atendimento: retry de entregas pendentes (backoff
  // 1min→6h, 5 tentativas). Entrega imediata acontece no send; isto é a
  // rede de segurança.
  const WebhookDispatchService = require("./src/services/WebhookDispatchService");
  WebhookDispatchService.startSweeper();
```

- [ ] **Step 4: Verificar + lint + commit do Slice 3**

Run: `node --check src/services/ConversationService.js; node --check src/services/ServiceRequestService.js; node --check index.js; npm run lint`
Expected: exit 0

```bash
git add src/utils/webhookUrl.js src/services/WebhookDispatchService.js src/services/ConversationService.js src/services/ServiceRequestService.js index.js
git commit -m "feat(atendimento-api): slice 3 — webhook push (HMAC + retry backoff + sweeper + anti-SSRF)"
git push
```

(Push aqui: migrations 171 + backend completo sobem juntos — o front do Slice 4 depende dos endpoints no ar.)

---

## SLICE 4 — Frontend `/mensagens` (painel + selo + i18n + flag)

Trabalhar em `../freelandoo frontend/freelandoo-website-main/` (quotar o path). **NUNCA `git add -A`** (WIP paralelo acasaviews).

### Task 12: Proxies Next

**Files:**
- Create: `app/api/me/api-connections/_proxy.ts`
- Create: `app/api/me/api-connections/route.ts`
- Create: `app/api/me/api-connections/[id]/revoke/route.ts`

**Antes de criar `[id]`:** conferir que NÃO existe outro diretório dinâmico com nome diferente no MESMO nível (`app/api/me/api-connections/`) — conflito `[id]` vs `[itemId]` no mesmo nível trava todas as lambdas em prod (bug já pago). Como o diretório é novo, só `[id]` existirá — ok.

- [ ] **Step 1: `_proxy.ts`** (mesmo conteúdo do `app/api/conversations/_proxy.ts`):

```ts
import { NextResponse } from "next/server"
import { getBackendApiUrl } from "@/lib/backend"

const BACKEND = getBackendApiUrl()

export async function proxyJson(response: Response) {
  const text = await response.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    data = text ? { error: text } : {}
  }
  return NextResponse.json(data, { status: response.status })
}

export function authHeader(request: Request) {
  return request.headers.get("authorization") || request.headers.get("Authorization")
}

export function backendUrl(path: string) {
  return `${BACKEND}${path}`
}
```

- [ ] **Step 2: `route.ts` (GET lista / POST cria)**

```ts
import { NextResponse } from "next/server"
import { authHeader, backendUrl, proxyJson } from "./_proxy"

export async function GET(request: Request) {
  const auth = authHeader(request)
  if (!auth) {
    return NextResponse.json({ error: "Autorizacao necessaria" }, { status: 401 })
  }
  const response = await fetch(backendUrl("/me/api-connections"), {
    method: "GET",
    headers: { Authorization: auth },
    cache: "no-store",
  })
  return proxyJson(response)
}

export async function POST(request: Request) {
  const auth = authHeader(request)
  if (!auth) {
    return NextResponse.json({ error: "Autorizacao necessaria" }, { status: 401 })
  }
  const body = await request.text()
  const response = await fetch(backendUrl("/me/api-connections"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body,
  })
  return proxyJson(response)
}
```

- [ ] **Step 3: `[id]/revoke/route.ts`**

```ts
import { NextResponse } from "next/server"
import { authHeader, backendUrl, proxyJson } from "../../_proxy"

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = authHeader(request)
  if (!auth) {
    return NextResponse.json({ error: "Autorizacao necessaria" }, { status: 401 })
  }
  const { id } = await ctx.params
  const response = await fetch(backendUrl(`/me/api-connections/${id}/revoke`), {
    method: "POST",
    headers: { Authorization: auth },
  })
  return proxyJson(response)
}
```

(Next 16: `params` é Promise — conferir como outras rotas dinâmicas de `app/api/` tipam; copiar o padrão local se divergir.)

### Task 13: `ApiConnectionsModal.tsx`

**Files:**
- Create: `components/mensagens/ApiConnectionsModal.tsx`

- [ ] **Step 1: Escrever o componente.** Dark utilitário reto (`.fl-sharp` no container), ns i18n **`ApiConnections`**, três estados: lista, formulário de criação, token-única-vez. Datas via `useLocale()`.

```tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import { Cable, Check, Copy, Loader2, Plus, ShieldAlert, Trash2, X } from "lucide-react"
import { getToken } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { useLocale, useTranslations } from "@/components/i18n/I18nProvider"

interface ApiConnection {
  id_connection: string
  name: string
  token_prefix: string
  scope_personal: boolean
  webhook_url: string | null
  status: "active" | "revoked"
  last_used_at: string | null
  last_ip: string | null
  created_at: string
}

function authHeaders(): HeadersInit {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function ApiConnectionsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("ApiConnections")
  const { locale } = useLocale()
  const [items, setItems] = useState<ApiConnection[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [scopePersonal, setScopePersonal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/me/api-connections", { headers: authHeaders(), cache: "no-store" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "err")
      setItems(Array.isArray(data?.connections) ? data.connections : [])
    } catch {
      setError(t("loadError", "Erro ao carregar conexões"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (open) {
      setNewToken(null)
      setCreating(false)
      void load()
    }
  }, [open, load])

  const handleCreate = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/me/api-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: name.trim(), scope_personal: scopePersonal }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "err")
      setNewToken(data?.token || null)
      setCreating(false)
      setName("")
      setScopePersonal(false)
      void load()
    } catch (e) {
      setError(e instanceof Error && e.message !== "err" ? e.message : t("createError", "Erro ao criar conexão"))
    } finally {
      setSaving(false)
    }
  }, [name, scopePersonal, load, t])

  const handleRevoke = useCallback(
    async (id: string) => {
      if (!window.confirm(t("revokeConfirm", "Revogar esta conexão? O software conectado perde o acesso na hora."))) return
      setRevoking(id)
      try {
        const res = await fetch(`/api/me/api-connections/${id}/revoke`, {
          method: "POST",
          headers: authHeaders(),
        })
        if (!res.ok) throw new Error("err")
        void load()
      } catch {
        setError(t("revokeError", "Erro ao revogar"))
      } finally {
        setRevoking(null)
      }
    },
    [load, t]
  )

  const handleCopy = useCallback(async () => {
    if (!newToken) return
    try {
      await navigator.clipboard.writeText(newToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard indisponível */
    }
  }, [newToken])

  const fmtDate = useCallback(
    (iso: string | null) => {
      if (!iso) return t("never", "nunca")
      return new Date(iso).toLocaleString(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    },
    [locale, t]
  )

  if (!open) return null

  const activeItems = items.filter((c) => c.status === "active")

  return (
    <div className="fl-sharp fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg border-2 border-[#F1EDE2]/15 bg-[#141009] text-[#F5F1E8] shadow-2xl">
        <div className="flex items-center justify-between border-b-2 border-[#F1EDE2]/12 px-5 py-4">
          <div className="flex items-center gap-2">
            <Cable className="h-4 w-4 text-[#F2B705]" />
            <h2 className="fl-display text-xl leading-none text-[#F2B705]">
              {t("title", "Conectar atendimento")}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t("close", "Fechar")} className="p-1 text-white/50 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {newToken ? (
            <div className="border-2 border-[#F2B705]/40 bg-[#F2B705]/5 p-4">
              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[#F2B705]">
                <ShieldAlert className="h-4 w-4" />
                {t("tokenOnceTitle", "Guarde este token agora")}
              </p>
              <p className="mt-2 text-xs text-white/70">
                {t("tokenOnceHint", "Ele não será mostrado de novo. Cole no seu software de atendimento.")}
              </p>
              <div className="mt-3 flex items-stretch gap-2">
                <code className="flex-1 overflow-x-auto whitespace-nowrap border border-white/15 bg-black/40 px-3 py-2 text-xs">
                  {newToken}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 border border-[#F2B705] bg-[#F2B705] px-3 text-xs font-bold text-black"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t("copied", "Copiado") : t("copy", "Copiar")}
                </button>
              </div>
              <button type="button" onClick={() => setNewToken(null)} className="mt-3 text-xs text-white/50 underline">
                {t("tokenDone", "Já guardei, voltar à lista")}
              </button>
            </div>
          ) : creating ? (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-[#8a8275]">
                {t("nameLabel", "Nome da conexão")}
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder={t("namePlaceholder", "Ex.: AtendeBot da loja")}
                className="mt-1 w-full border-2 border-[#F1EDE2]/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-[#F2B705]/60"
              />
              <label className="mt-4 flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={scopePersonal}
                  onChange={(e) => setScopePersonal(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#F2B705]"
                />
                <span className="text-xs text-white/75">
                  <span className="font-bold">{t("scopeLabel", "Incluir minhas mensagens pessoais")}</span>
                  <br />
                  <span className="text-white/50">
                    {t("scopeHint", "Sem isso, o software só vê O.S. e conversas novas que chegarem depois de conectar.")}
                  </span>
                </span>
              </label>
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={saving || name.trim().length < 2}
                  className="inline-flex items-center gap-1.5 border-2 border-[#F2B705] bg-[#F2B705] px-4 py-2 text-xs font-black uppercase tracking-wider text-black disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {t("createSubmit", "Gerar token")}
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="border-2 border-white/15 px-4 py-2 text-xs font-black uppercase tracking-wider text-white/60"
                >
                  {t("cancel", "Cancelar")}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs leading-relaxed text-white/60">
                {t(
                  "intro",
                  "Gere um token e cole no seu software de atendimento para ele ler e responder suas conversas comerciais. Só responde — nunca inicia conversa."
                )}
              </p>
              {error && <p className="mt-3 border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-white/40" />
                </div>
              ) : activeItems.length === 0 ? (
                <p className="py-6 text-center text-xs text-white/40">{t("empty", "Nenhuma conexão ativa.")}</p>
              ) : (
                <ul className="mt-4 flex flex-col gap-2">
                  {activeItems.map((c) => (
                    <li key={c.id_connection} className="border-2 border-[#F1EDE2]/12 bg-white/[0.03] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">{c.name}</p>
                          <p className="mt-0.5 font-mono text-[11px] text-white/45">{c.token_prefix}…</p>
                          <p className="mt-1 text-[11px] text-white/50">
                            {c.scope_personal
                              ? t("scopeFull", "O.S. + novas + pessoais")
                              : t("scopeCommercial", "O.S. + conversas novas")}
                            {" · "}
                            {t("lastUsed", "último uso:")} {fmtDate(c.last_used_at)}
                            {c.last_ip ? ` (${c.last_ip})` : ""}
                          </p>
                          <p className={cn("mt-0.5 text-[11px]", c.webhook_url ? "text-emerald-400/80" : "text-amber-400/80")}>
                            {c.webhook_url ? t("webhookOn", "Webhook configurado") : t("webhookOff", "Aguardando o software configurar o webhook")}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRevoke(c.id_connection)}
                          disabled={revoking === c.id_connection}
                          className="inline-flex items-center gap-1 border border-red-500/40 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-red-300 disabled:opacity-40"
                        >
                          {revoking === c.id_connection ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          {t("revoke", "Revogar")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => setCreating(true)}
                disabled={activeItems.length >= 3}
                className="mt-4 inline-flex items-center gap-1.5 border-2 border-[#F2B705] px-4 py-2 text-xs font-black uppercase tracking-wider text-[#F2B705] disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("newConnection", "Nova conexão")}
              </button>
              {activeItems.length >= 3 && (
                <p className="mt-2 text-[11px] text-white/40">{t("limitHint", "Limite de 3 conexões ativas. Revogue uma para criar outra.")}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

(Conferir a API real de `useLocale()` no `I18nProvider` — se retornar a string direto em vez de `{ locale }`, ajustar a desestruturação.)

- [ ] **Step 2:** Sem verificação isolada — valida junto no lint/build do Slice (Task 15).

### Task 14: Integração no MensagensClient + selo `sent_via`

**Files:**
- Modify: `components/mensagens/types.ts:42-60` (MessageItem)
- Modify: `components/mensagens/MensagensClient.tsx` (imports ~linha 3-57, header ~linha 1209-1227, bolha O.S. ~linha 1832, bolha DM ~linha 1987+)

- [ ] **Step 1: Tipo.** Em `types.ts`, adicionar ao `MessageItem` (depois de `status: string`):

```ts
  sent_via?: "app" | "api"
```

E no tipo local das mensagens de O.S. dentro do `MensagensClient.tsx` (procurar a interface/type usado por `osMessages` — tem campos `sender`, `content`, `created_at`), adicionar `sent_via?: "app" | "api"`.

- [ ] **Step 2: Botão "Conectar atendimento".** Imports no topo do `MensagensClient.tsx`: adicionar `Cable` à lista do lucide-react e `import { useFeature } from "@/components/feature-flags/FeatureFlagsProvider"`. Modal lazy junto dos outros dynamic():

```tsx
const ApiConnectionsModal = dynamic(
  () => import("@/components/mensagens/ApiConnectionsModal").then((m) => m.ApiConnectionsModal),
  { ssr: false }
)
```

Estado junto dos outros useState do componente: `const [apiConnOpen, setApiConnOpen] = useState(false)` e `const apiFeatureOn = useFeature("atendimento_api")`.

No header, dentro do bloco `tab === "conv"` (linha ~1210, div `flex items-center gap-1.5`), ANTES do botão de criar grupo:

```tsx
                {apiFeatureOn && (
                  <button
                    type="button"
                    onClick={() => setApiConnOpen(true)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-white/60 transition-colors hover:border-[#F2B705]/60 hover:text-[#F2B705]"
                    title={t("apiConnectionsButton", "Conectar atendimento")}
                    aria-label={t("apiConnectionsButton", "Conectar atendimento")}
                  >
                    <Cable className="h-4 w-4" />
                  </button>
                )}
```

(O botão de grupo vizinho usa `rounded-full` — é o padrão atual DESSA tela; regra do escoteiro dos cantos aplica no MODAL novo, não obriga requadrar a tela toda nesta entrega.)

Render do modal: junto de onde `CreateGroupModal` é renderizado (procurar `<CreateGroupModal` no arquivo):

```tsx
      <ApiConnectionsModal open={apiConnOpen} onClose={() => setApiConnOpen(false)} />
```

- [ ] **Step 3: Selo na bolha O.S.** (linha ~1832, o span do horário):

```tsx
                                  <span className={cn("mt-0.5 px-1 text-[10px] tabular-nums", mine ? "text-white/40" : "text-white/35")}>
                                    {mine && m.sent_via === "api" ? `${t("viaApiBadge", "via atendimento")} · ` : ""}
                                    {formatTime(m.created_at, locale)}
                                  </span>
```

- [ ] **Step 4: Selo na bolha DM.** Na região da linha ~1987 (`const mine = m.sender_entity_id === actorId`), localizar o span de horário equivalente dessa bolha (mesmo padrão `formatTime(m.created_at, locale)`) e aplicar o MESMO prefixo condicional `{mine && m.sent_via === "api" ? \`${t("viaApiBadge", "via atendimento")} · \` : ""}`.

### Task 15: i18n (3 idiomas, mesmo commit) + validação + commit

**Files:**
- Create: `scripts/i18n-atendimento-merge.js`
- Modify (gerado): `messages/pt-BR.json`, `messages/en.json`, `messages/es.json`

- [ ] **Step 1: Script merge idempotente** (padrão das ondas: fill-if-absent, cada chave `[pt,en,es]`):

```js
// i18n da API de Atendimento: ns novo "ApiConnections" + 2 chaves no ns
// "Messages" (botão + selo). Idempotente e não-destrutivo: só ADICIONA chaves
// ausentes. Rodar com: node scripts/i18n-atendimento-merge.js
const fs = require("fs")
const path = require("path")

const dir = path.join(__dirname, "..", "messages")

const API_CONNECTIONS = {
  title: ["Conectar atendimento", "Connect support tool", "Conectar atención"],
  close: ["Fechar", "Close", "Cerrar"],
  intro: [
    "Gere um token e cole no seu software de atendimento para ele ler e responder suas conversas comerciais. Só responde — nunca inicia conversa.",
    "Generate a token and paste it into your support software so it can read and reply to your business conversations. Reply-only — it never starts a conversation.",
    "Genera un token y pégalo en tu software de atención para que lea y responda tus conversaciones comerciales. Solo responde: nunca inicia una conversación.",
  ],
  loadError: ["Erro ao carregar conexões", "Error loading connections", "Error al cargar conexiones"],
  createError: ["Erro ao criar conexão", "Error creating connection", "Error al crear la conexión"],
  revokeError: ["Erro ao revogar", "Error revoking", "Error al revocar"],
  revokeConfirm: [
    "Revogar esta conexão? O software conectado perde o acesso na hora.",
    "Revoke this connection? The connected software loses access immediately.",
    "¿Revocar esta conexión? El software conectado pierde el acceso al instante.",
  ],
  revoke: ["Revogar", "Revoke", "Revocar"],
  empty: ["Nenhuma conexão ativa.", "No active connections.", "Ninguna conexión activa."],
  newConnection: ["Nova conexão", "New connection", "Nueva conexión"],
  limitHint: [
    "Limite de 3 conexões ativas. Revogue uma para criar outra.",
    "Limit of 3 active connections. Revoke one to create another.",
    "Límite de 3 conexiones activas. Revoca una para crear otra.",
  ],
  nameLabel: ["Nome da conexão", "Connection name", "Nombre de la conexión"],
  namePlaceholder: ["Ex.: AtendeBot da loja", "E.g.: Store support bot", "Ej.: Bot de atención de la tienda"],
  scopeLabel: ["Incluir minhas mensagens pessoais", "Include my personal messages", "Incluir mis mensajes personales"],
  scopeHint: [
    "Sem isso, o software só vê O.S. e conversas novas que chegarem depois de conectar.",
    "Without this, the software only sees work orders and new conversations that arrive after connecting.",
    "Sin esto, el software solo ve órdenes de servicio y conversaciones nuevas que lleguen después de conectar.",
  ],
  createSubmit: ["Gerar token", "Generate token", "Generar token"],
  cancel: ["Cancelar", "Cancel", "Cancelar"],
  tokenOnceTitle: ["Guarde este token agora", "Save this token now", "Guarda este token ahora"],
  tokenOnceHint: [
    "Ele não será mostrado de novo. Cole no seu software de atendimento.",
    "It will not be shown again. Paste it into your support software.",
    "No se mostrará de nuevo. Pégalo en tu software de atención.",
  ],
  copy: ["Copiar", "Copy", "Copiar"],
  copied: ["Copiado", "Copied", "Copiado"],
  tokenDone: ["Já guardei, voltar à lista", "Saved it, back to the list", "Ya lo guardé, volver a la lista"],
  scopeFull: ["O.S. + novas + pessoais", "Work orders + new + personal", "Órdenes + nuevas + personales"],
  scopeCommercial: ["O.S. + conversas novas", "Work orders + new conversations", "Órdenes + conversaciones nuevas"],
  lastUsed: ["último uso:", "last used:", "último uso:"],
  never: ["nunca", "never", "nunca"],
  webhookOn: ["Webhook configurado", "Webhook configured", "Webhook configurado"],
  webhookOff: [
    "Aguardando o software configurar o webhook",
    "Waiting for the software to configure the webhook",
    "Esperando que el software configure el webhook",
  ],
}

const MESSAGES_EXTRA = {
  apiConnectionsButton: ["Conectar atendimento", "Connect support tool", "Conectar atención"],
  viaApiBadge: ["via atendimento", "via support tool", "vía atención"],
}

const LOCALES = ["pt-BR", "en", "es"]

function mergeNamespace(json, ns, keys, localeIndex) {
  if (!json[ns]) json[ns] = {}
  let added = 0
  for (const [key, values] of Object.entries(keys)) {
    if (json[ns][key] === undefined) {
      json[ns][key] = values[localeIndex]
      added++
    }
  }
  return added
}

for (let i = 0; i < LOCALES.length; i++) {
  const file = path.join(dir, `${LOCALES[i]}.json`)
  const json = JSON.parse(fs.readFileSync(file, "utf8"))
  let added = 0
  added += mergeNamespace(json, "ApiConnections", API_CONNECTIONS, i)
  added += mergeNamespace(json, "Messages", MESSAGES_EXTRA, i)
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n", "utf8")
  console.log(`${LOCALES[i]}: +${added} chaves`)
}
```

**Antes de rodar:** abrir um script de onda existente (`scripts/i18n-onda3-merge.js`) e conferir o formato de escrita dos JSONs (indentação/ordenação de chaves) — se o padrão do repo ordenar chaves alfabeticamente, replicar.

- [ ] **Step 2: Rodar o merge**

Run: `node scripts/i18n-atendimento-merge.js`
Expected: `pt-BR: +XX chaves` / `en: +XX` / `es: +XX` (idempotente: rodar 2ª vez dá +0)

- [ ] **Step 3: Regra do escoteiro (i18n).** Rodar `node scripts/i18n-coverage.js components/mensagens/MensagensClient.tsx` — o arquivo já foi traduzido em onda anterior; se o scanner apontar resto de pt hardcoded NAS LINHAS TOCADAS, corrigir na entrega. Cross-check: toda chave `t("...")` nova usada existe nos 3 dicts após o merge.

- [ ] **Step 4: Validar + commit (SÓ caminhos explícitos)**

Run: `npm run lint` → 0 warnings; `npm run build` → sucesso
Expected: PASS nos dois

```bash
git add "app/api/me/api-connections" "components/mensagens/ApiConnectionsModal.tsx" "components/mensagens/MensagensClient.tsx" "components/mensagens/types.ts" "scripts/i18n-atendimento-merge.js" "messages/pt-BR.json" "messages/en.json" "messages/es.json"
git commit -m "feat(atendimento-api): slice 4 — painel Conectar atendimento em /mensagens + selo via atendimento + i18n"
git push
```

---

## SLICE 5 — Docs + simulador e2e

### Task 16: `docs/API_ATENDIMENTO.md` + simulador

**Files (backend repo):**
- Create: `docs/API_ATENDIMENTO.md`
- Create: `scripts/atendimento-simulator.js`

- [ ] **Step 1: Documentação de contrato** — conteúdo completo:

````markdown
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
````

- [ ] **Step 2: Simulador (echo bot e2e)**

```js
// scripts/atendimento-simulator.js
// Simulador de software de atendimento para teste e2e da API de Atendimento:
// registra webhook local, valida HMAC e responde automaticamente cada
// message.received. Uso:
//   FLND_TOKEN=flnd_atd_xxx [BACKEND_URL=http://localhost:3000] [PORT=4545] \
//     node scripts/atendimento-simulator.js
// O backend local precisa de ALLOW_INSECURE_WEBHOOK=1 pra aceitar http://localhost.
const http = require("http");
const crypto = require("crypto");

const TOKEN = process.env.FLND_TOKEN;
const BACKEND = (process.env.BACKEND_URL || "http://localhost:3000").replace(/\/$/, "");
const PORT = Number(process.env.PORT) || 4545;

if (!TOKEN || !TOKEN.startsWith("flnd_atd_")) {
  console.error("Defina FLND_TOKEN=flnd_atd_... (gere em /mensagens → Conectar atendimento)");
  process.exit(1);
}

let webhookSecret = null;

async function api(method, path, body) {
  const res = await fetch(`${BACKEND}/ext/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${data?.error || "?"}`);
  return data;
}

function validSignature(headers, rawBody) {
  const ts = headers["x-freelandoo-timestamp"];
  const sig = headers["x-freelandoo-signature"] || "";
  if (!ts || !sig || !webhookSecret) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", webhookSecret).update(`${ts}.${rawBody}`, "utf8").digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/hook") {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", async () => {
    res.writeHead(200).end("ok"); // responde rápido; processa depois
    if (!validSignature(req.headers, raw)) {
      console.warn("⚠ webhook com assinatura INVÁLIDA — ignorado");
      return;
    }
    try {
      const event = JSON.parse(raw);
      if (event.event !== "message.received") return;
      const convId = event.conversation?.id;
      const from = event.message?.sender?.display_name || event.message?.sender?.username || "cliente";
      console.log(`📩 [${convId}] ${from}: ${event.message?.body}`);
      const reply = await api("POST", `/conversations/${convId}/messages`, {
        body: `Recebido! (resposta automática do simulador) Você disse: "${String(event.message?.body || "").slice(0, 100)}"`,
      });
      console.log(`🤖 respondido em ${convId} (id_message ${reply?.message?.id_message})`);
    } catch (err) {
      console.error("erro processando webhook:", err.message);
    }
  });
});

(async () => {
  const me = await api("GET", "/me");
  console.log(`✔ token ok — conexão "${me.connection?.name}" do user @${me.user?.username}`);
  const wh = await api("POST", "/webhook", { url: `http://localhost:${PORT}/hook` });
  webhookSecret = wh.webhook_secret;
  console.log(`✔ webhook registrado: ${wh.webhook_url}`);
  const convs = await api("GET", "/conversations?limit=10");
  console.log(`✔ ${convs.items?.length ?? 0} conversas no escopo:`);
  for (const c of convs.items || []) {
    console.log(`   ${c.id} [${c.type}] ${c.counterpart?.display_name || c.counterpart?.username || ""} — "${c.last_message_preview || ""}"`);
  }
  server.listen(PORT, () => {
    console.log(`👂 aguardando webhooks em http://localhost:${PORT}/hook — mande uma mensagem pra conta no site`);
  });
})().catch((err) => {
  console.error("falha na inicialização:", err.message);
  process.exit(1);
});
```

- [ ] **Step 3: Verificar + commit**

Run: `node --check scripts/atendimento-simulator.js; npm run lint`
Expected: exit 0

```bash
git add docs/API_ATENDIMENTO.md scripts/atendimento-simulator.js
git commit -m "feat(atendimento-api): slice 5 — doc de contrato + simulador e2e (echo bot)"
git push
```

### Task 17: Housekeeping final

**Files:**
- Modify: `../CLAUDE.md` (raiz do projeto — fora dos git repos)
- Create: memória `project_freelandoo_api_atendimento.md` + linha no `MEMORY.md`

- [ ] **Step 1:** Adicionar seção curta no `CLAUDE.md` (feature ativa: API de Atendimento — decisões-chave: token pessoal sem QR, escopo O.S.+novas+opt-in, só responde, webhook HMAC `${timestamp}.${body}`, selo dono-only, flag `atendimento_api`, ids `dm:`/`os:`, doc de contrato em `freelandoo-backend/docs/API_ATENDIMENTO.md`) e registrar estado dos slices.
- [ ] **Step 2:** Gravar memória com o resumo + pendências de validação (e2e com simulador exige backend local + banco, mesmo bloqueio de ambiente do `test:checkout`).

---

## E2E manual (quando o ambiente local permitir)

1. Backend local com Postgres (docker `fl-test-pg`) + `ALLOW_INSECURE_WEBHOOK=1`; migration 171 roda no boot.
2. No site: login → `/mensagens` → Conectar atendimento → gerar token (testar toggle ON e OFF).
3. `FLND_TOKEN=... node scripts/atendimento-simulator.js` → deve listar conversas do escopo.
4. Com OUTRO usuário, mandar DM nova pro dono → simulador loga `📩` e responde `🤖`; no site, a resposta aparece na conversa com selo "via atendimento" SÓ na visão do dono.
5. Abrir uma O.S. com o dono (comprador manda mensagem) → mesmo fluxo via `os:`.
6. Revogar o token no painel → próximo request do simulador dá 401.
7. Desligar a flag `atendimento_api` no Painel de Controle → `/ext/v1/*` responde 403 e o botão some.

## Self-review (feita na escrita do plano)

- **Cobertura do spec:** modelo de dados ✔ (Task 1), auth ✔ (T3/T5), endpoints internos ✔ (T4) e externos ✔ (T8), escopo ✔ (T7), webhook+HMAC+SSRF+retry ✔ (T9–T11), selo dono-only ✔ (T6/T14), frontend+i18n+flag ✔ (T12–T15), docs+simulador ✔ (T16). **Desvios conscientes do spec:** (a) assinatura HMAC cobre `${timestamp}.${body}` (anti-replay) em vez de só body — documentado; (b) listagem usa `updated_since`+`limit` sem cursor na v1 — documentado.
- **Placeholders:** nenhum "TBD"; os 3 pontos de "conferir no código local" (export de `runWithLogs`, API de `useLocale`, tipagem de `params` no Next 16) são verificações de 30s contra arquivos existentes, com fallback claro.
- **Consistência de tipos/nomes:** `sent_via` threading confere ponta a ponta (storage → service → ext → front); `opts.sent_via` nunca vem de body HTTP; ids `dm:`/`os:` idênticos em service, docs e simulador; assinatura verificada no simulador igual à gerada no dispatch.
