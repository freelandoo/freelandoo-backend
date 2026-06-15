# Comunidades (substituem Clans) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o conceito de Clan pela Comunidade — página própria estilo Casa Views (tema claro, cores customizáveis, pública/indexada) com 3 abas (Feed/Bees/Membros), criada só por user (1 grátis + 2 pagas R$100 em bundle +1 criar/+1 entrar), requisito subperfil nível 5, XP = espelho do líder + acumulador por membro/ciclo, ranking de comunidades com benchmark por nível e votação de liderança; clans desativados sem migração.

**Architecture:** Reaproveita `tb_profile` com um novo tipo `is_community` (posts/bees/feed/chat já indexados por `id_profile`). Membros são USERS (`tb_community_member`). Backend em camadas (routes→controllers→services→storages, SQL puro, `runWithLogs`/`sendServiceResult`). Migrations idempotentes rodadas no boot. Frontend Next.js App Router com proxies em `app/api/`, i18n pt/en/es por padrão. O ciclo da comunidade engata no rollover de temporada (`RankingStorage.rollSeasonsIfDue`).

**Tech Stack:** Express 5 + PostgreSQL puro (`pg`), Stripe (`price_data` ad-hoc + webhook idempotente), Cloudflare R2, Next.js 16 + Tailwind 4 + Radix/shadcn, provider i18n próprio.

**Convenções globais (valem para TODOS os slices):**
- Backend repo: `freelandoo-backend/` (CWD do git). Frontend repo: `freelandoo frontend/freelandoo-website-main/` (path com espaço — sempre quotar; git repo próprio).
- **Nunca `git add -A`** (há WIP paralelo Casa Views). Commitar só os caminhos do slice.
- Validação backend: `node migrate-remote.js` (ou boot local) + `npm run test:checkout` quando o slice toca dinheiro.
- Validação frontend: `npm run lint` (max-warnings 0) + `npm run build`.
- i18n: todo texto visível nasce `t("chave","fallback pt")` via `useTranslations(ns)` + script merge idempotente rodado no mesmo commit.
- Commit+push entre slices nos 2 repos. Padrão: `feat(comunidade): slice N — descrição`.

---

## File Structure

**Backend (criar):**
- `src/databases/migrations/154_communities.sql` — schema base (tipo + membros + entitlement).
- `src/databases/migrations/155_community_xp_ranking.sql` — acumulador + snapshot de ranking.
- `src/databases/migrations/156_community_leadership.sql` — votação.
- `src/databases/migrations/157_clans_deactivate.sql` — desativa clans.
- `src/storages/CommunityStorage.js` — SQL de comunidade/membros/tema/entitlement.
- `src/storages/CommunityVoteStorage.js` — SQL de votação.
- `src/services/CommunityService.js` — CRUD, página, membros, regras de cap/nível.
- `src/services/CommunityXpService.js` — XP espelhado + acumulador + nível.
- `src/services/CommunityRankingService.js` — snapshot + benchmark por nível.
- `src/services/CommunityLeadershipService.js` — gatilho de elegibilidade + votação + resolução.
- `src/services/CommunitySlotService.js` — bundle R$100 (Stripe checkout + entitlement).
- `src/controllers/CommunityController.js`, `src/controllers/CommunityVoteController.js`.
- `src/routes/community.routes.js` (auth), `src/routes/communityPublic.routes.js` (público).

**Backend (modificar):**
- `src/storages/XpStorage.js` — `recalcProfileXp` passa a propagar para a comunidade do líder (além do clan legado).
- `src/storages/RankingStorage.js` — `rollSeasonsIfDue` chama o ciclo de comunidade.
- `src/services/StripeWebhookService.js` — handler do bundle de comunidade (fulfill/expire/refund).
- `src/routes/index.js` — registra rotas novas; mantém clan inerte.
- vitrine/busca/feed: garantir filtro `is_community = FALSE` onde hoje filtra `is_clan = FALSE`.

**Frontend (criar):** `app/comunidade/[id]/page.tsx` (+ subcomponentes `_components/`), `app/comunidade/page.tsx` (lista), proxies `app/api/communities/...`, modal de votação no layout logado, fluxo de criação/checkout, `scripts/i18n-comunidade-merge.js`.

**Frontend (modificar):** aba "Clans" → "Comunidade" na navegação; remover entradas de UI de clan.

---

## Slice 0 — Schema base (migration 154)

**Files:**
- Create: `src/databases/migrations/154_communities.sql`

- [ ] **Step 1: Escrever a migration idempotente**

```sql
-- Migration 154: Comunidades (tipo novo em tb_profile + membros user-level + entitlement)
BEGIN;

ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS is_community   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS community_theme JSONB  NULL,
  ADD COLUMN IF NOT EXISTS id_leader_user UUID   NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL;

-- Comunidade segue a regra de taxonomia do clan (id_machine sem id_category)
ALTER TABLE public.tb_profile DROP CONSTRAINT IF EXISTS chk_profile_clan_taxonomy;
ALTER TABLE public.tb_profile ADD CONSTRAINT chk_profile_clan_taxonomy CHECK (
  ( is_clan = FALSE AND is_community = FALSE AND id_category IS NOT NULL ) OR
  ( is_clan = TRUE  AND id_machine  IS NOT NULL AND id_category IS NULL ) OR
  ( is_community = TRUE AND id_machine IS NOT NULL AND id_category IS NULL )
);

CREATE INDEX IF NOT EXISTS idx_tb_profile_community
  ON public.tb_profile (id_machine) WHERE is_community = TRUE AND deleted_at IS NULL;

-- Membros são USERS. role: leader | vice | member
CREATE TABLE IF NOT EXISTS public.tb_community_member (
  id_community_profile UUID        NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user              UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  role                 VARCHAR(16) NOT NULL DEFAULT 'member' CHECK (role IN ('leader','vice','member')),
  joined_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_community_profile, id_user)
);
CREATE INDEX IF NOT EXISTS idx_community_member_user ON public.tb_community_member (id_user);
CREATE UNIQUE INDEX IF NOT EXISTS ux_community_one_leader
  ON public.tb_community_member (id_community_profile) WHERE role = 'leader';

-- Tetos por user (default 1 criar / 1 entrar)
CREATE TABLE IF NOT EXISTS public.tb_community_entitlement (
  id_user     UUID        PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  create_cap  INT         NOT NULL DEFAULT 1 CHECK (create_cap BETWEEN 1 AND 3),
  member_cap  INT         NOT NULL DEFAULT 1 CHECK (member_cap BETWEEN 1 AND 3),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Compras do bundle R$100 (idempotente por stripe_session_id)
CREATE TABLE IF NOT EXISTS public.tb_community_slot_purchase (
  id_purchase              BIGSERIAL    PRIMARY KEY,
  id_user_payer            UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE RESTRICT,
  stripe_session_id        VARCHAR(255) NULL,
  stripe_payment_intent_id VARCHAR(255) NULL,
  amount_cents             INT          NOT NULL DEFAULT 10000,
  currency                 VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  status                   VARCHAR(16)  NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','paid','canceled','failed','refunded')),
  applied_at               TIMESTAMPTZ  NULL,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  paid_at                  TIMESTAMPTZ  NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_community_slot_session
  ON public.tb_community_slot_purchase (stripe_session_id) WHERE stripe_session_id IS NOT NULL;

COMMIT;
```

- [ ] **Step 2: Rodar a migration**

Run (CWD `freelandoo-backend`): `node migrate-remote.js`
Expected: log `154_communities` aplicada sem erro; re-rodar é no-op (idempotente).

- [ ] **Step 3: Verificar schema**

Run: `node -e "const{Pool}=require('pg');const p=new Pool();p.query(\"select column_name from information_schema.columns where table_name='tb_profile' and column_name in ('is_community','community_theme','id_leader_user')\").then(r=>{console.log(r.rows);process.exit()})"`
Expected: 3 colunas listadas.

- [ ] **Step 4: Commit**

```bash
git add src/databases/migrations/154_communities.sql
git commit -m "feat(comunidade): slice 0 — schema base (tipo is_community + membros user-level + entitlement)"
git push
```

---

## Slice 1 — CommunityStorage + CommunityService (criação com gate nível 5 + tetos)

**Files:**
- Create: `src/storages/CommunityStorage.js`, `src/services/CommunityService.js`, `src/controllers/CommunityController.js`, `src/routes/community.routes.js`, `src/routes/communityPublic.routes.js`
- Modify: `src/routes/index.js`

- [ ] **Step 1: CommunityStorage — métodos base**

Criar `src/storages/CommunityStorage.js` espelhando o estilo de `ClanStorage.js` (SQL puro). Métodos:
- `getEntitlement(db, id_user)` — retorna a linha de `tb_community_entitlement`, criando default (1/1) se ausente (`INSERT ... ON CONFLICT DO NOTHING` + select).
- `countOwned(db, id_user)` — `SELECT COUNT(*) FROM tb_profile WHERE id_leader_user=$1 AND is_community=TRUE AND deleted_at IS NULL`.
- `countMemberships(db, id_user)` — `SELECT COUNT(*) FROM tb_community_member m JOIN tb_profile p ON p.id_profile=m.id_community_profile WHERE m.id_user=$1 AND p.deleted_at IS NULL`.
- `getHighestSubprofileLevel(db, id_user)` — `SELECT COALESCE(MAX(xp_level),0) AS lvl, MAX(xp_total) AS xp FROM tb_profile WHERE id_user=$1 AND is_clan=FALSE AND is_community=FALSE AND deleted_at IS NULL`.
- `createCommunity(db, {id_user, name, id_machine, theme})` — insere `tb_profile` (`is_community=TRUE`, `id_leader_user`, `id_machine`, `community_theme`) + `tb_community_member` (role `leader`), em transação. Retorna o perfil.
- `getById(db, id_community)`, `listPublic(db, {q, id_machine, limit, offset})` (só `is_community=TRUE AND deleted_at IS NULL`).
- `addMember(db, id_community, id_user, role='member')`, `removeMember(db, id_community, id_user)`, `getMembership(db, id_community, id_user)`, `listMembers(db, id_community)`.
- `updateTheme(db, id_community, theme)`.

- [ ] **Step 2: CommunityService — regras de criação**

Criar `src/services/CommunityService.js` usando `runWithLogs`. `createCommunity({ id_user, name, id_machine, theme })`:

```js
async createCommunity(log, { id_user, name, id_machine, theme }) {
  return runWithLogs(log, "CommunityService.createCommunity", () => ({ id_user }), async () => {
    const { lvl } = await CommunityStorage.getHighestSubprofileLevel(db, id_user);
    if (Number(lvl) < 5) return { error: "Você precisa de pelo menos um subperfil nível 5 para criar uma comunidade." };

    const ent = await CommunityStorage.getEntitlement(db, id_user);
    const owned = await CommunityStorage.countOwned(db, id_user);
    if (owned >= ent.create_cap) return { error: "Limite de comunidades criadas atingido. Compre um ingresso para criar mais." };

    const memberships = await CommunityStorage.countMemberships(db, id_user);
    if (memberships >= ent.member_cap) return { error: "Limite de participação atingido. Compre um ingresso para entrar em mais comunidades." };

    if (!name?.trim() || !id_machine) return { error: "Nome e enxame são obrigatórios." };
    return CommunityStorage.createCommunity(db, { id_user, name: name.trim(), id_machine, theme: theme ?? null });
  });
}
```

(`db` = pool importado como nos outros services.)

- [ ] **Step 3: Controller + rotas**

`CommunityController.js`: `create`, `getOne`, `listPublic`, `getMembers`, `updateTheme`. Cada um chama o service e usa `sendServiceResult(res, result)`.
`community.routes.js` (montado com `authMiddleware`): `POST /communities`, `PATCH /communities/:id/theme`.
`communityPublic.routes.js` (público): `GET /communities`, `GET /communities/:id`, `GET /communities/:id/members`.
Em `src/routes/index.js`, registrar os routers (público antes do auth para as rotas GET).

- [ ] **Step 4: Validar boot + smoke das rotas**

Run: subir o backend local; `curl localhost:PORT/communities` → `{ communities: [] }` (200).
Run: `POST /communities` autenticado com user sem nível 5 → 4xx com a mensagem de nível 5.

- [ ] **Step 5: Commit**

```bash
git add src/storages/CommunityStorage.js src/services/CommunityService.js src/controllers/CommunityController.js src/routes/community.routes.js src/routes/communityPublic.routes.js src/routes/index.js
git commit -m "feat(comunidade): slice 1 — CRUD backend + gate nivel 5 + tetos de criacao/participacao"
git push
```

---

## Slice 2 — Entrada/saída de membros (enforcement de tetos)

**Files:**
- Modify: `src/services/CommunityService.js`, `src/controllers/CommunityController.js`, `src/routes/community.routes.js`

- [ ] **Step 1: Service join/leave**

```js
async join(log, { id_user, id_community }) {
  return runWithLogs(log, "CommunityService.join", () => ({ id_user, id_community }), async () => {
    const sub = await CommunityStorage.getHighestSubprofileLevel(db, id_user); // exige >=1 subperfil
    if (sub.lvl == null) return { error: "Você precisa de pelo menos um subperfil para entrar." };
    const community = await CommunityStorage.getById(db, id_community);
    if (!community || community.is_community !== true) return { error: "Comunidade não encontrada." };
    const already = await CommunityStorage.getMembership(db, id_community, id_user);
    if (already) return { ok: true, role: already.role };
    const ent = await CommunityStorage.getEntitlement(db, id_user);
    const memberships = await CommunityStorage.countMemberships(db, id_user);
    if (memberships >= ent.member_cap) return { error: "Limite de participação atingido. Compre um ingresso para entrar em mais comunidades." };
    await CommunityStorage.addMember(db, id_community, id_user, "member");
    return { ok: true, role: "member" };
  });
}

async leave(log, { id_user, id_community }) {
  return runWithLogs(log, "CommunityService.leave", () => ({ id_user, id_community }), async () => {
    const m = await CommunityStorage.getMembership(db, id_community, id_user);
    if (!m) return { ok: true };
    if (m.role === "leader") return { error: "O líder não pode sair; transfira a liderança ou exclua a comunidade." };
    await CommunityStorage.removeMember(db, id_community, id_user);
    return { ok: true };
  });
}
```

- [ ] **Step 2: Rotas** `POST /communities/:id/join`, `POST /communities/:id/leave` (auth). Controller delega ao service.

- [ ] **Step 3: Smoke** — entrar/sair; tentar entrar numa 2ª comunidade com `member_cap=1` → erro de limite.

- [ ] **Step 4: Commit**

```bash
git add src/services/CommunityService.js src/controllers/CommunityController.js src/routes/community.routes.js
git commit -m "feat(comunidade): slice 2 — entrada/saida de membros com enforcement de teto"
git push
```

---

## Slice 3 — Bundle R$100 (Stripe + webhook idempotente + entitlement +1/+1) [TOCA DINHEIRO]

**Files:**
- Create: `src/services/CommunitySlotService.js`
- Modify: `src/services/StripeWebhookService.js`, `src/storages/CommunityStorage.js`, `src/controllers/CommunityController.js`, `src/routes/community.routes.js`

- [ ] **Step 1: CommunityStorage — apply entitlement (idempotente)**

```js
// Sobe +1/+1 (respeitando o teto 3) e marca a compra como aplicada. Idempotente:
// só aplica se a purchase ainda não foi aplicada (applied_at IS NULL) na mesma tx.
async applySlotPurchase(db, { id_purchase }) {
  return db.tx(async (t) => {
    const r = await t.query(
      `UPDATE tb_community_slot_purchase SET status='paid', paid_at=NOW(), applied_at=NOW()
         WHERE id_purchase=$1 AND applied_at IS NULL RETURNING id_user_payer`, [id_purchase]);
    if (!r.rows.length) return { applied: false };
    const id_user = r.rows[0].id_user_payer;
    await t.query(
      `INSERT INTO tb_community_entitlement (id_user, create_cap, member_cap)
         VALUES ($1, 2, 2)
       ON CONFLICT (id_user) DO UPDATE
         SET create_cap = LEAST(3, tb_community_entitlement.create_cap + 1),
             member_cap = LEAST(3, tb_community_entitlement.member_cap + 1),
             updated_at = NOW()`, [id_user]);
    return { applied: true, id_user };
  });
}
```

(Se o projeto não tiver `db.tx`, usar `BEGIN/COMMIT` manual como nos outros storages.)

- [ ] **Step 2: CommunitySlotService — criar checkout**

`createCheckout(log, { id_user })`: insere `tb_community_slot_purchase` (pending) e cria Stripe Checkout Session com `price_data` ad-hoc (R$100, BRL, `mode:'payment'`), `metadata: { kind:'community_slot', id_purchase }`, idempotente, retornando `{ url }`. Espelhar o padrão de `PolenService`/Manifestação.

- [ ] **Step 3: Webhook — fulfill/expire/refund**

Em `StripeWebhookService.js`, no handler de `checkout.session.completed`, ramo `metadata.kind === 'community_slot'` → `CommunitySlotService.fulfill({ session })` que chama `applySlotPurchase`. Adicionar:
- `checkout.session.expired` / `async_payment_failed` → marca purchase `failed`/`canceled` (não aplica).
- `charge.refunded` com `isFullRefund(charge)` → reverte: `status='refunded'` e, se `applied_at` setado, `create_cap`/`member_cap` `GREATEST(1, cap-1)` (não abaixo de 1; não force abaixo de comunidades já criadas — se `owned > create_cap-1`, manter e logar).
Seguir a regra do PayDebug: confirmador idempotente por session id; retorna `{error}`/`{canceled}` quando NÃO entrega.

- [ ] **Step 4: Rota** `POST /communities/slots/checkout` (auth) → `{ url }`.

- [ ] **Step 5: Validar e2e de dinheiro**

Run (CWD `freelandoo-backend`, docker `fl-test-pg` + `STRIPE_SECRET_KEY` de teste): estender `npm run test:checkout` com um caso do bundle de comunidade (checkout → webhook completed → entitlement 2/2; webhook duplicado → continua 2/2; refund total → volta 1/1).
Expected: PASS, incluindo idempotência e refund.

- [ ] **Step 6: Commit**

```bash
git add src/services/CommunitySlotService.js src/services/StripeWebhookService.js src/storages/CommunityStorage.js src/controllers/CommunityController.js src/routes/community.routes.js test/checkout/*
git commit -m "feat(comunidade): slice 3 — bundle R$100 (Stripe + webhook idempotente + entitlement +1/+1)"
git push
```

---

## Slice 4 — XP da comunidade + acumulador + ranking/benchmark (migration 155)

**Files:**
- Create: `src/databases/migrations/155_community_xp_ranking.sql`, `src/services/CommunityXpService.js`, `src/services/CommunityRankingService.js`
- Modify: `src/storages/XpStorage.js`, `src/storages/RankingStorage.js`

- [ ] **Step 1: Migration 155**

```sql
BEGIN;
CREATE TABLE IF NOT EXISTS public.tb_community_xp_accumulator (
  id_community_profile UUID PRIMARY KEY REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  accumulated_xp       NUMERIC NOT NULL DEFAULT 0,
  last_cycle_applied   INT     NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS public.tb_community_ranking_snapshot (
  id            BIGSERIAL   PRIMARY KEY,
  season_number INT         NOT NULL,
  id_community  UUID        NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  xp_total      NUMERIC     NOT NULL DEFAULT 0,
  xp_level      INT         NOT NULL DEFAULT 0,
  position      INT         NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_comm_snapshot_season_community
  ON public.tb_community_ranking_snapshot (season_number, id_community);
COMMIT;
```

- [ ] **Step 2: CommunityXpService — XP = líder + acumulador**

```js
// total = xp do subperfil de maior XP do líder + accumulated_xp; nível pela fórmula log.
async recalc(db, id_community) {
  const settings = await XpStorage.getSettings(db);
  const base = Number(settings.base_xp_level_1), mult = Number(settings.level_multiplier);
  const lead = await db.query(
    `SELECT COALESCE(MAX(p.xp_total),0) AS leader_xp
       FROM tb_profile c
       JOIN tb_community_member m ON m.id_community_profile=c.id_profile AND m.role='leader'
       JOIN tb_profile p ON p.id_user=m.id_user AND p.is_clan=FALSE AND p.is_community=FALSE AND p.deleted_at IS NULL
      WHERE c.id_profile=$1`, [id_community]);
  const acc = await db.query(
    `SELECT COALESCE(accumulated_xp,0) AS acc FROM tb_community_xp_accumulator WHERE id_community_profile=$1`, [id_community]);
  const total = Number(lead.rows[0]?.leader_xp || 0) + Number(acc.rows[0]?.acc || 0);
  const level = XpStorage.levelFromXp(total, base, mult);
  await db.query(`UPDATE tb_profile SET xp_total=$2, xp_level=$3 WHERE id_profile=$1`, [id_community, total, level]);
  return { total, level };
}

// Acumulador do ciclo: +1 por membro.
async applyCycleAccumulator(db, season_number) {
  await db.query(
    `INSERT INTO tb_community_xp_accumulator (id_community_profile, accumulated_xp, last_cycle_applied)
       SELECT c.id_profile, (SELECT COUNT(*) FROM tb_community_member m WHERE m.id_community_profile=c.id_profile), $1
         FROM tb_profile c WHERE c.is_community=TRUE AND c.deleted_at IS NULL
     ON CONFLICT (id_community_profile) DO UPDATE
       SET accumulated_xp = tb_community_xp_accumulator.accumulated_xp +
             (SELECT COUNT(*) FROM tb_community_member m WHERE m.id_community_profile = EXCLUDED.id_community_profile),
           last_cycle_applied = $1
     WHERE tb_community_xp_accumulator.last_cycle_applied < $1`, [season_number]);
}
```

- [ ] **Step 3: Propagar XP do líder em tempo real**

Em `XpStorage.recalcProfileXp`, após `recalcClanXp`, adicionar `await CommunityXpService.recalcForLeaderUser(db, id_user)` (recalcula as comunidades onde esse user é líder). Manter clan legado funcionando.

- [ ] **Step 4: CommunityRankingService — snapshot + benchmark**

`runCycle(db, season_number)`:
1. `CommunityXpService.applyCycleAccumulator(db, season_number)` e recalc de todas as comunidades.
2. Inserir snapshot `(season_number, id_community, xp_total, xp_level, position)` ordenado por `xp_total DESC` (position = row_number).
3. Benchmark por nível: para cada nível, crescimento médio = `AVG((xp_total_atual - xp_total_anterior) / NULLIF(xp_total_anterior,0))` comparando snapshot atual vs anterior (mesma comunidade). Expor `getBenchmark(db, season_number)`.
4. `getEligibleForVote(db, season_number)`: comunidades cujo crescimento ficou **muito abaixo** da média do seu nível (ex.: `< 0.5 * media`) **ou** que perderam posição (position atual > anterior).

- [ ] **Step 5: Engatar no rollover**

Em `RankingStorage.rollSeasonsIfDue`, após avançar `season_number`, chamar `CommunityRankingService.runCycle(db, novaSeason - 1)` e `CommunityLeadershipService.openEligibleVotes(db, novaSeason - 1)` (Slice 5). Envolver em try/catch para não derrubar o rollover.

- [ ] **Step 6: Validar** — simular 2 ciclos com `period_days` curto; conferir snapshot, acumulador (+membros) e XP espelhando o líder.

- [ ] **Step 7: Commit**

```bash
git add src/databases/migrations/155_community_xp_ranking.sql src/services/CommunityXpService.js src/services/CommunityRankingService.js src/storages/XpStorage.js src/storages/RankingStorage.js
git commit -m "feat(comunidade): slice 4 — XP espelhado + acumulador por ciclo + ranking/benchmark por nivel"
git push
```

---

## Slice 5 — Votação de liderança (migration 156)

**Files:**
- Create: `src/databases/migrations/156_community_leadership.sql`, `src/storages/CommunityVoteStorage.js`, `src/services/CommunityLeadershipService.js`, `src/controllers/CommunityVoteController.js`
- Modify: `src/routes/community.routes.js`, `src/routes/index.js`

- [ ] **Step 1: Migration 156**

```sql
BEGIN;
CREATE TABLE IF NOT EXISTS public.tb_community_leadership_vote (
  id_vote          BIGSERIAL   PRIMARY KEY,
  id_community     UUID        NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_leader_user   UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_challenger_user UUID      NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  status           VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','canceled')),
  result           VARCHAR(16) NULL CHECK (result IN ('leader_kept','leader_changed','tie_kept')),
  opens_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closes_at        TIMESTAMPTZ NOT NULL,
  resolved_at      TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_comm_vote_open
  ON public.tb_community_leadership_vote (id_community) WHERE status='open';
CREATE TABLE IF NOT EXISTS public.tb_community_vote_ballot (
  id_vote   BIGINT      NOT NULL REFERENCES public.tb_community_leadership_vote(id_vote) ON DELETE CASCADE,
  id_user   UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  choice    VARCHAR(16) NOT NULL CHECK (choice IN ('leader','challenger')),
  voted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_vote, id_user)
);
COMMIT;
```

- [ ] **Step 2: CommunityLeadershipService.openEligibleVotes(db, season_number)**

Para cada comunidade elegível (`CommunityRankingService.getEligibleForVote`):
1. Achar o membro de maior nível (subperfil de maior XP por user) com nível **>** o do líder. Se nenhum, pular.
2. Se já há voto `open`, pular (UNIQUE protege).
3. Inserir voto com `closes_at = NOW() + interval '7 days'`, `id_challenger_user` = esse membro.

- [ ] **Step 3: Endpoints de votação**

- `GET /communities/votes/pending` (auth) — votos `open` das comunidades onde o user é membro **e ainda não votou**, com cards do líder e do desafiante (display_name, avatar, nível). Alimenta o modal de login.
- `POST /communities/votes/:id/ballot` (auth, body `{ choice }`) — registra voto (idempotente por `(id_vote,id_user)`; só se membro).

- [ ] **Step 4: Resolução** `resolveDueVotes(db)`:

```js
// Fecha votos vencidos (closes_at <= now). Maioria simples; empate mantém líder.
// Líder destituído vira 'vice'. Re-baseia XP (CommunityXpService.recalc).
```
Conta `choice='challenger'` vs `'leader'`. Se challenger > leader: troca papéis (novo líder `leader`, antigo `vice`, atualiza `tb_profile.id_leader_user`), `result='leader_changed'`; senão `leader_kept`/`tie_kept`. Chamar `resolveDueVotes` no mesmo gancho do rollover (Slice 4, Step 5) e/ou num job de boot.

- [ ] **Step 5: Validar** — abrir voto manual, votar com 3 membros, fechar e conferir troca/vice + re-base de XP.

- [ ] **Step 6: Commit**

```bash
git add src/databases/migrations/156_community_leadership.sql src/storages/CommunityVoteStorage.js src/services/CommunityLeadershipService.js src/controllers/CommunityVoteController.js src/routes/community.routes.js src/routes/index.js
git commit -m "feat(comunidade): slice 5 — votacao de lideranca (gatilho, cedulas, resolucao 7d, vice-lider)"
git push
```

---

## Slice 6 — Desativar clans (migration 157 + filtros)

**Files:**
- Create: `src/databases/migrations/157_clans_deactivate.sql`
- Modify: rotas/serviços que listam perfis (garantir filtro `is_community=FALSE` junto de `is_clan=FALSE` em vitrine/busca/feed); `src/routes/index.js` (desmontar rotas de clan ou deixar inertes).

- [ ] **Step 1: Migration 157**

```sql
BEGIN;
-- Esconde clans ativos (sem migrar). Payouts/splits pendentes ficam preservados.
UPDATE public.tb_profile SET is_active = FALSE
 WHERE is_clan = TRUE AND deleted_at IS NULL AND is_active = TRUE;
COMMIT;
```

- [ ] **Step 2: Filtros** — em `SearchStorage`/`PortfolioFeedStorage`/`RankingStorage` onde já existe `is_clan = FALSE`, adicionar `AND is_community = FALSE` para a comunidade não vazar na vitrine/busca/ranking de perfis (ela tem ranking próprio).

- [ ] **Step 3: Rotas** — em `src/routes/index.js`, remover o registro de `clan.routes`/`clanPublic.routes` (deixa o código no repo, só não monta). Garantir que o app sobe sem 404 quebrando nada do feed.

- [ ] **Step 4: Validar** — busca/vitrine não mostram clans nem comunidades; boot ok.

- [ ] **Step 5: Commit**

```bash
git add src/databases/migrations/157_clans_deactivate.sql src/storages/SearchStorage.js src/storages/PortfolioFeedStorage.js src/storages/RankingStorage.js src/routes/index.js
git commit -m "feat(comunidade): slice 6 — desativa clans (sem migracao) + filtra comunidade da vitrine/busca/ranking de perfis"
git push
```

---

## Slice 7 — Frontend: página da comunidade (Casa Views style, 3 abas) + i18n

**Files (CWD `freelandoo frontend/freelandoo-website-main`):**
- Create: `app/comunidade/[id]/page.tsx`, `app/comunidade/[id]/_components/{CommunityHeader,FeedTab,BeesTab,MembersTab,ThemeEditor}.tsx`, `app/comunidade/page.tsx`, `app/api/communities/[...path]/route.ts`, `scripts/i18n-comunidade-merge.js`
- Modify: navegação onde a aba "Clans" aparece → "Comunidade".

- [ ] **Step 1: Proxy catch-all** `app/api/communities/[...path]/route.ts` → encaminha para o backend (sem prefixo `/api`), repassando o JWT (padrão dos outros proxies admin/payments).

- [ ] **Step 2: Página da comunidade** `app/comunidade/[id]/page.tsx` — tema claro estilo Casa Views (referência: a página de participante da Casa Views). Header com nome/avatar/banner, cores vindas de `community_theme`, contador de membros, nível e posição no ranking. Tabs Feed/Bees/Membros (reusar os cards de feed 4:5 e bees 9:16 existentes, filtrando por `id_profile` da comunidade). Estados empty/loading/error desenhados.

- [ ] **Step 3: ThemeEditor** — visível só pro líder: abre painel, escolhe cores, `PATCH /communities/:id/theme`. Otimista + revert no erro.

- [ ] **Step 4: Lista** `app/comunidade/page.tsx` — grid público das comunidades (`GET /communities`), busca por nome/enxame. Aba "Clans" da navegação renomeada para "Comunidade" apontando aqui.

- [ ] **Step 5: i18n** — namespace `Community`; todo texto com `t("chave","fallback pt")`; criar `scripts/i18n-comunidade-merge.js` (fill-if-absent, chave=`["pt","en","es"]`) e rodar. Conteúdo de usuário (posts/bees/nomes) não traduz.

- [ ] **Step 6: Validar**

Run: `npm run lint` → 0 warnings. `npm run build` → sucesso. Cross-check chaves usadas × `messages/*.json`.

- [ ] **Step 7: Commit (paths explícitos — nunca `-A`)**

```bash
git add app/comunidade "app/api/communities" scripts/i18n-comunidade-merge.js messages/pt-BR.json messages/en.json messages/es.json
git commit -m "feat(comunidade): slice 7 — pagina da comunidade (Casa Views style, 3 abas) + i18n pt/en/es"
git push
```

---

## Slice 8 — Frontend: criar/entrar + checkout bundle + modal de votação no login

**Files (CWD frontend):**
- Create: `app/comunidade/criar/page.tsx`, `app/comunidade/_components/CommunityVoteModal.tsx`, `app/comunidade/_components/SlotPurchaseDialog.tsx`
- Modify: layout/área logada para montar o `CommunityVoteModal`; merge i18n.

- [ ] **Step 1: Criar comunidade** `app/comunidade/criar/page.tsx` — form (nome + enxame via `useTaxonomy()`), valida gate de nível 5 (mostra erro do backend), cria via `POST /communities`. Se `create_cap` esgotado, oferece `SlotPurchaseDialog`.

- [ ] **Step 2: SlotPurchaseDialog** — explica o bundle R$100 (+1 criar/+1 entrar), botão "Comprar ingresso" → `POST /communities/slots/checkout` → redireciona para a `url` do Stripe.

- [ ] **Step 3: Botão Entrar/Sair** na página da comunidade (`POST /communities/:id/join` / `leave`); se `member_cap` esgotado, abre `SlotPurchaseDialog`.

- [ ] **Step 4: Modal de votação no login** `CommunityVoteModal` — ao montar a área logada, busca `GET /communities/votes/pending`; se houver, abre modal com card do líder e do desafiante + texto *"Sua comunidade está evoluindo pouco — quer manter [líder] ou trocar para [desafiante]?"* e dois botões → `POST /communities/votes/:id/ballot`. Fecha ao votar; reabre o próximo pendente. i18n.

- [ ] **Step 5: Validar** `npm run lint` + `npm run build`; smoke do fluxo criar → (sem slot) comprar → criar; votar no modal.

- [ ] **Step 6: Commit**

```bash
git add app/comunidade/criar "app/comunidade/_components" messages/pt-BR.json messages/en.json messages/es.json scripts/i18n-comunidade-merge.js
git commit -m "feat(comunidade): slice 8 — criar/entrar + checkout bundle R$100 + modal de votacao no login"
git push
```

---

## Self-Review (cobertura da spec)

- §1 Conceito / §6 UI Casa Views 3 abas → Slice 7. ✓
- §2 Modelo (is_community, membros user-level) → Slice 0–1. ✓
- §3 Criação + gate nível 5 → Slice 1. ✓
- §4 Bundle R$100 (+1/+1) → Slice 3 (backend) + Slice 8 (UI). ✓
- §5 Entrada aberta + ≥1 subperfil → Slice 2. ✓
- §7 XP espelho+acumulador + ranking + benchmark → Slice 4. ✓
- §8 Votação (gatilho, líder×maior nível, 7d maioria, vice, re-base) → Slice 5 + modal Slice 8. ✓
- §9 Desativar clans sem migração → Slice 6. ✓
- §10 Superfície backend (services/jobs/migrations) → Slices 0,1,3,4,5,6. ✓
- §11 Decisões cravadas (maior XP do user / qualquer membro posta / vice modera) → Slices 4,5,7. ✓

**Pendências do Alex (não-codáveis daqui):** assinar `checkout.session.expired` no dashboard Stripe (igual PayDebug); docker `fl-test-pg` + `STRIPE_SECRET_KEY` de teste para rodar `test:checkout` do Slice 3; passar o token de 60 dias se for reusar infra Casa Views como referência visual (não é dependência de código).

**Riscos:** (1) garantir que `is_community` não vaze em nenhuma listagem de perfis (varrer todos os `is_clan = FALSE`); (2) re-base de XP na troca de líder não pode reduzir abaixo do acumulador; (3) webhook do bundle precisa ser at-least-once idempotente (já coberto no Slice 3).
