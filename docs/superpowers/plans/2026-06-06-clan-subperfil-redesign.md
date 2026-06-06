# Clan como Subperfil Coletivo — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Este projeto **não tem suíte de testes automatizados** (`npm test` é no-op). A verificação de cada slice é: (1) `npm run lint` sem warnings, (2) migration idempotente aplica no boot, (3) checagem read-only no banco de prod **após deploy**, (4) checagem manual de endpoint quando aplicável. Commit + push por slice (migrations no mesmo commit do código que as usa).

**Goal:** Transformar o clan num subperfil coletivo que espelha posts/bees, hospeda serviços/cursos com perfis anexados, e divide a venda igualmente no Saldo de cada anexado.

**Architecture:** Evolução do `tb_profile is_clan=true` existente. Reusa Saldo (mig 067), GroupConversation, `tb_profile_service_member`, agregação de portfolio. Adiciona: `tb_clan_payout` (split que paga de verdade), `tb_course_member` (anexo em curso), `id_user`+UNIQUE em `tb_clan_member` (1 clan por usuário), sincronização de chat de grupo, e skip de afiliado.

**Tech Stack:** Node/Express 5, PostgreSQL puro (`pg`), Stripe, R2. Frontend Next.js 16 (App Router). Migrations idempotentes numeradas, rodam no boot (`run-migrations.js`).

**Spec:** `docs/superpowers/specs/2026-06-06-clan-subperfil-redesign-design.md`

## Refinamentos descobertos no planejamento (vs spec)

1. **`tb_clan_payout` nova (não reusar `tb_booking_payout`)**: `tb_booking_payout` tem `UNIQUE(id_booking)` e 1 `id_owner_user` por linha — não comporta N anexados por venda. Crio uma tabela irmã `tb_clan_payout` (N linhas por venda, mesma lifecycle `aguardando→aprovado→pago→revertido`, mesmo holdback de 8 dias, liberada pelo mesmo cron). "Saldo é fonte única" se mantém: o leitor de Saldo passa a unir booking payouts + clan payouts.
2. **Bloqueio de produto já existe**: `ProfileProductService.assertOwnerWithProfile` já retorna "Clans não podem ter loja de produtos". Slice 7 fica só com o **afiliado**.
3. **Serviço de clan já anexa membros**: `ProfileServiceService.create/update` já aceita `member_profile_ids` quando `is_clan`. Falta só **abrir a permissão de criação** pra qualquer membro (hoje gated no `id_user` do dono).

---

## File Structure

**Migrations novas (a partir de 124):**
- `124_clan_one_per_user.sql` — `id_user`+UNIQUE em `tb_clan_member` + backfill.
- `125_course_members.sql` — `tb_course_member`.
- `126_clan_payout.sql` — `tb_clan_payout` + origem.
- `127_clan_group_chat.sql` — coluna `id_clan_profile` em conversa de grupo.

**Backend novo/modificado:**
- `src/storages/ClanStorage.js` — checagem 1-clan-por-user, sync de chat.
- `src/storages/ClanPayoutStorage.js` (novo) — CRUD do split→saldo.
- `src/storages/CourseMemberStorage.js` (novo) — anexo de curso.
- `src/services/ClanService.js` — validações de criação/convite; cria grupo ao criar clan.
- `src/services/BookingService.js` — redireciona split pro `tb_clan_payout`.
- `src/services/CoursesService.js` — split de curso no confirm; CRUD de anexados.
- `src/services/ProfileServiceService.js` — permissão "qualquer membro".
- `src/services/BookingPayoutService.js` — leitor de Saldo une clan payouts.
- `src/services/StripeWebhookService.js` — skip de afiliado pra clan.
- `src/services/GroupConversationService.js` — helper de sync (add/remove membro).

**Frontend (slice 8):**
- `app/(header-only)/account/clans/[id_profile]/page.tsx` — criar serviço/curso, anexar membros, ver saldo do clan.
- `components/.../course` editor — anexar perfis.
- página do clan (`freelancer-profile-view`) — aba Bees espelhada, co-autoria.

---

## Slice 1 — Regra "1 clan por usuário" + schema base

**Files:**
- Create: `src/databases/migrations/124_clan_one_per_user.sql`
- Modify: `src/storages/ClanStorage.js`, `src/services/ClanService.js`

- [ ] **Step 1: Migration `id_user` + UNIQUE + backfill**

Create `src/databases/migrations/124_clan_one_per_user.sql`:

```sql
-- =============================================================================
-- Migration 124: 1 clan por USUÁRIO (não por subperfil)
-- =============================================================================
-- tb_clan_member referencia subperfil; pra garantir "um usuário em no máximo um
-- clan" denormalizamos id_user e impomos UNIQUE(id_user). Idempotente.
-- =============================================================================

ALTER TABLE public.tb_clan_member
  ADD COLUMN IF NOT EXISTS id_user UUID REFERENCES public.tb_user(id_user) ON DELETE CASCADE;

-- Backfill a partir do dono do subperfil membro
UPDATE public.tb_clan_member cm
   SET id_user = p.id_user
  FROM public.tb_profile p
 WHERE p.id_profile = cm.id_member_profile
   AND cm.id_user IS DISTINCT FROM p.id_user;

ALTER TABLE public.tb_clan_member
  ALTER COLUMN id_user SET NOT NULL;

-- UNIQUE: um usuário aparece em no máximo uma linha de membro (= um clan)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clan_member_user_unique
  ON public.tb_clan_member (id_user);
```

- [ ] **Step 2: ClanStorage — checar se o user já está em clan + setar id_user no addMember**

Em `src/storages/ClanStorage.js`, adicionar método e incluir `id_user` no insert de membro:

```js
  static async findMembershipByUser(conn, id_user) {
    const r = await conn.query(
      `SELECT id_clan_profile FROM public.tb_clan_member WHERE id_user = $1 LIMIT 1`,
      [id_user]
    );
    return r.rowCount ? r.rows[0] : null;
  }
```

Modificar `addMember` para gravar `id_user` (derivado do subperfil):

```js
  static async addMember(conn, { id_clan_profile, id_member_profile, role }) {
    const r = await conn.query(
      `
      INSERT INTO public.tb_clan_member
        (id_clan_profile, id_member_profile, role, id_user)
      VALUES ($1, $2, $3,
        (SELECT id_user FROM public.tb_profile WHERE id_profile = $2))
      RETURNING id_clan_profile, id_member_profile, role, joined_at
      `,
      [id_clan_profile, id_member_profile, role || "member"]
    );
    return r.rows[0];
  }
```

- [ ] **Step 3: ClanService.create — bloquear se o user do dono já está em clan**

Em `src/services/ClanService.js`, dentro de `create`, após validar `subProfile` e antes do `createClanProfile`, adicionar:

```js
          const userMembership = await ClanStorage.findMembershipByUser(client, id_user);
          if (userMembership) {
            await client.query("ROLLBACK");
            return { error: "Você já participa de um clan (1 clan por usuário)" };
          }
```

- [ ] **Step 4: ClanService.invite + respondInvite — bloquear convidado cujo user já está em clan**

Em `invite`, após carregar `invited`, adicionar (usa o client da transação):

```js
          const invitedUserMembership = await ClanStorage.findMembershipByUser(client, invited.id_user);
          if (invitedUserMembership) {
            await client.query("ROLLBACK");
            return { error: "Este usuário já participa de um clan" };
          }
```

Em `respondInvite` (action accept), após `existingMembership` por perfil, revalidar por user:

```js
          const inviteeUserId = invitedProfileRes.rows[0].id_user;
          const acceptUserMembership = await ClanStorage.findMembershipByUser(client, inviteeUserId);
          if (acceptUserMembership) {
            await client.query("ROLLBACK");
            return { error: "Você já participa de um clan" };
          }
```

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: sem erros/warnings.

- [ ] **Step 6: Commit + push**

```bash
git add src/databases/migrations/124_clan_one_per_user.sql src/storages/ClanStorage.js src/services/ClanService.js
git commit -m "feat(clans): slice 1 — 1 clan por usuário (id_user UNIQUE em tb_clan_member)"
git push origin main
```

- [ ] **Step 7: Verificar em prod após deploy (read-only)**

```bash
node -e "require('dotenv').config();process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';const{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});p.query(\"SELECT COUNT(*) total, COUNT(DISTINCT id_user) users FROM tb_clan_member\").then(r=>{console.log(r.rows[0]);return p.end()})"
```
Expected: `total === users` (sem usuário em 2 clans) e migration 124 aplicada.

---

## Slice 2 — Permissão coletiva de itens (qualquer membro cria serviço/curso)

**Files:**
- Modify: `src/services/ProfileServiceService.js`, `src/storages/ClanStorage.js`

- [ ] **Step 1: ClanStorage — helper "user é membro do clan"**

Já existe `getUserMembership(conn, id_clan_profile, id_user)` (retorna `{id_member_profile, role}` ou null). Reusar.

- [ ] **Step 2: ProfileServiceService — gate clan-aware**

Em `src/services/ProfileServiceService.js`, trocar `assertOwnerWithProfile` por uma versão que, se o perfil é clan, aceita **qualquer membro**:

```js
const ClanStorage = require("../storages/ClanStorage");

async function assertCanManageProfile(conn, id_profile, id_user) {
  const profile = await ProfileStorage.getProfileById(conn, id_profile);
  if (!profile) return { error: "Perfil não encontrado" };
  if (profile.is_clan) {
    const membership = await ClanStorage.getUserMembership(conn, id_profile, id_user);
    if (!membership) return { error: "Apenas membros do clan podem gerenciar serviços" };
    return { profile, membership };
  }
  if (String(profile.id_user) !== String(id_user)) {
    return { error: "Sem permissão para alterar este perfil" };
  }
  return { profile };
}
```

Substituir as chamadas `assertOwnerWithProfile` por `assertCanManageProfile` em `create`/`update`/`delete`/`list`.

- [ ] **Step 3: ProfileServiceService — exigir ≥1 anexado ao publicar serviço de clan**

Em `create` e `update`, quando `own.profile.is_clan`, validar:

```js
        if (own.profile.is_clan && (!Array.isArray(memberIds) || memberIds.length === 0)) {
          await client.query("ROLLBACK");
          return { error: "Anexe pelo menos um perfil do clan ao serviço" };
        }
```

(`memberIds` já é resolvido nestes métodos via `v.data.member_profile_ids`.)

- [ ] **Step 4: ProfileServiceService — editar/excluir só o que criou (dono modera)**

Em `update`/`delete`, após `assertCanManageProfile`, quando clan e `membership.role !== 'owner'`, checar autoria do item. Requer coluna de autor no serviço — ver Step 5.

- [ ] **Step 5: Migration — autor do item de serviço (pra "edita o seu")**

Create `src/databases/migrations/125a_service_author.sql`:

```sql
ALTER TABLE public.tb_profile_service
  ADD COLUMN IF NOT EXISTS created_by_user UUID REFERENCES public.tb_user(id_user) ON DELETE SET NULL;
```

Gravar `created_by_user = id_user` no `ProfileServiceStorage.create`. Na edição/exclusão por não-owner, exigir `created_by_user === id_user`.

- [ ] **Step 6: Lint + commit + push**

```bash
git add src/databases/migrations/125a_service_author.sql src/services/ProfileServiceService.js src/storages/ProfileServiceStorage.js
git commit -m "feat(clans): slice 2 — qualquer membro cria serviço; criador edita o seu, dono modera; >=1 anexado"
git push origin main
```

---

## Slice 3 — Split de serviço que paga de verdade (→ Saldo)

**Files:**
- Create: `src/databases/migrations/126_clan_payout.sql`, `src/storages/ClanPayoutStorage.js`
- Modify: `src/services/BookingService.js`, `src/services/BookingPayoutService.js`

- [ ] **Step 1: Migration `tb_clan_payout`**

Create `src/databases/migrations/126_clan_payout.sql`:

```sql
-- =============================================================================
-- Migration 126: Saldo de split de clan (N membros por venda)
-- =============================================================================
-- Espelha tb_booking_payout, mas aceita N linhas por venda (uma por membro
-- anexado), pra serviços E cursos de clan. Mesma lifecycle e holdback de 8 dias.
-- Liberada pelo mesmo cron (status aguardando->aprovado quando available_at<=NOW).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_clan_payout (
  id_clan_payout    BIGSERIAL    PRIMARY KEY,
  id_clan_profile   UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_member_profile UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE RESTRICT,
  id_owner_user     UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE RESTRICT,
  source_type       VARCHAR(20)  NOT NULL CHECK (source_type IN ('clan_service','clan_course')),
  source_id         VARCHAR(64)  NOT NULL,
  gross_cents       INT          NOT NULL CHECK (gross_cents >= 0),
  amount_cents      INT          NOT NULL CHECK (amount_cents >= 0),
  status            VARCHAR(20)  NOT NULL DEFAULT 'aguardando'
                      CHECK (status IN ('aguardando','aprovado','pago','revertido')),
  available_at      TIMESTAMPTZ  NOT NULL,
  approved_at       TIMESTAMPTZ,
  paid_out_at       TIMESTAMPTZ,
  paid_out_note     TEXT,
  reverted_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Idempotência por venda: não duplica split do mesmo source
CREATE UNIQUE INDEX IF NOT EXISTS idx_clan_payout_source_member
  ON public.tb_clan_payout (source_type, source_id, id_member_profile);

CREATE INDEX IF NOT EXISTS idx_clan_payout_owner
  ON public.tb_clan_payout (id_owner_user, status, available_at);
CREATE INDEX IF NOT EXISTS idx_clan_payout_release
  ON public.tb_clan_payout (status, available_at);
```

- [ ] **Step 2: ClanPayoutStorage (novo)**

Create `src/storages/ClanPayoutStorage.js`:

```js
class ClanPayoutStorage {
  static async existsForSource(conn, source_type, source_id) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_clan_payout WHERE source_type=$1 AND source_id=$2 LIMIT 1`,
      [source_type, String(source_id)]
    );
    return r.rowCount > 0;
  }

  static async createSplits(conn, { id_clan_profile, source_type, source_id, gross_cents, rows }) {
    if (!rows || rows.length === 0) return [];
    const values = [];
    const params = [];
    let i = 1;
    for (const { id_member_profile, id_owner_user, amount_cents } of rows) {
      values.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++}, NOW() + INTERVAL '8 days')`);
      params.push(id_clan_profile, id_member_profile, id_owner_user, source_type, String(source_id), gross_cents, amount_cents);
    }
    const r = await conn.query(
      `INSERT INTO public.tb_clan_payout
         (id_clan_profile, id_member_profile, id_owner_user, source_type, source_id, gross_cents, amount_cents, available_at)
       VALUES ${values.join(", ")}
       ON CONFLICT (source_type, source_id, id_member_profile) DO NOTHING
       RETURNING id_clan_payout, id_member_profile, amount_cents`,
      params
    );
    return r.rows;
  }

  static async listForOwner(conn, id_owner_user, { status, limit = 100, offset = 0 } = {}) {
    const params = [id_owner_user];
    let where = "WHERE cp.id_owner_user = $1";
    if (status) { params.push(status); where += ` AND cp.status = $${params.length}`; }
    params.push(limit, offset);
    const r = await conn.query(
      `SELECT cp.*, clan.display_name AS clan_display_name
         FROM public.tb_clan_payout cp
         JOIN public.tb_profile clan ON clan.id_profile = cp.id_clan_profile
         ${where}
         ORDER BY cp.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  static async releaseDue(conn) {
    const r = await conn.query(
      `UPDATE public.tb_clan_payout
          SET status='aprovado', approved_at=NOW(), updated_at=NOW()
        WHERE status='aguardando' AND available_at <= NOW()
        RETURNING id_clan_payout, id_owner_user`
    );
    return r.rows;
  }
}
module.exports = ClanPayoutStorage;
```

- [ ] **Step 3: BookingService — redirecionar split pro Saldo**

Em `src/services/BookingService.js`, reescrever `recordClanSplitForBooking` pra creditar `tb_clan_payout` (uma row por anexado) em vez da tabela morta. Usa `professional_amount` como `gross`, resolve anexados via `ProfileServiceStorage.getMemberIds` (≥1 garantido na publicação), busca `id_user` de cada membro:

```js
  static async recordClanSplitForBooking(booking) {
    if (!booking) return null;
    const profile = await ProfileStorage.getProfileById(pool, booking.id_profile);
    if (!profile || !profile.is_clan) return null;

    if (await ClanPayoutStorage.existsForSource(pool, "clan_service", booking.id)) return null;

    let memberIds = [];
    if (booking.id_profile_service != null) {
      memberIds = await ProfileServiceStorage.getMemberIds(pool, booking.id_profile_service);
    }
    if (memberIds.length === 0) return null; // publicação exige >=1 anexado

    const gross = Number(booking.professional_amount) || 0;
    if (gross <= 0) return null;

    const owners = await ProfileStorage.getOwnerUserMap(pool, memberIds); // {id_profile: id_user}
    const N = memberIds.length;
    const per = Math.floor(gross / N);
    const remainder = gross - per * N;
    const rows = memberIds.map((id_member_profile, idx) => ({
      id_member_profile,
      id_owner_user: owners[id_member_profile],
      amount_cents: per + (idx === 0 ? remainder : 0),
    }));

    return ClanPayoutStorage.createSplits(pool, {
      id_clan_profile: booking.id_profile,
      source_type: "clan_service",
      source_id: String(booking.id),
      gross_cents: gross,
      rows,
    });
  }
```

Adicionar no topo: `const ClanPayoutStorage = require("../storages/ClanPayoutStorage");` e remover o require de `ClanEarningSplitStorage`.

- [ ] **Step 4: ProfileStorage.getOwnerUserMap (helper)**

Em `src/storages/ProfileStorage.js`:

```js
  static async getOwnerUserMap(conn, profileIds) {
    if (!profileIds || profileIds.length === 0) return {};
    const r = await conn.query(
      `SELECT id_profile, id_user FROM public.tb_profile WHERE id_profile = ANY($1::uuid[])`,
      [profileIds]
    );
    const map = {};
    for (const row of r.rows) map[row.id_profile] = row.id_user;
    return map;
  }
```

- [ ] **Step 5: BookingPayoutService — incluir clan payouts no Saldo + no cron**

No service que lista o Saldo do usuário e no cron `releaseDue`, unir `ClanPayoutStorage`. Localizar onde `BookingPayoutStorage.listForOwner` e `releaseDue` são chamados e adicionar a fonte clan (merge das duas listas por `created_at`).

- [ ] **Step 6: Lint + commit + push**

```bash
git add src/databases/migrations/126_clan_payout.sql src/storages/ClanPayoutStorage.js src/storages/ProfileStorage.js src/services/BookingService.js src/services/BookingPayoutService.js
git commit -m "feat(clans): slice 3 — split de serviço cai no Saldo (tb_clan_payout, holdback 8d)"
git push origin main
```

---

## Slice 4 — Split de curso (→ Saldo) + anexar perfis em curso

**Files:**
- Create: `src/databases/migrations/125_course_members.sql`, `src/storages/CourseMemberStorage.js`
- Modify: `src/services/CoursesService.js`

- [ ] **Step 1: Migration `tb_course_member`**

Create `src/databases/migrations/125_course_members.sql`:

```sql
-- =============================================================================
-- Migration 125: Perfis anexados a um curso de clan (co-autores que dividem)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_course_member (
  course_id         UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  id_member_profile UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (course_id, id_member_profile)
);
CREATE INDEX IF NOT EXISTS idx_course_member_profile
  ON public.tb_course_member (id_member_profile);
```

- [ ] **Step 2: CourseMemberStorage (novo)**

Create `src/storages/CourseMemberStorage.js`:

```js
class CourseMemberStorage {
  static async setMembers(conn, course_id, memberIds) {
    await conn.query(`DELETE FROM public.tb_course_member WHERE course_id = $1`, [course_id]);
    if (!memberIds || memberIds.length === 0) return [];
    const values = memberIds.map((_, i) => `($1, $${i + 2})`).join(", ");
    const r = await conn.query(
      `INSERT INTO public.tb_course_member (course_id, id_member_profile)
       VALUES ${values}
       ON CONFLICT DO NOTHING
       RETURNING id_member_profile`,
      [course_id, ...memberIds]
    );
    return r.rows;
  }

  static async getMemberIds(conn, course_id) {
    const r = await conn.query(
      `SELECT id_member_profile FROM public.tb_course_member WHERE course_id = $1`,
      [course_id]
    );
    return r.rows.map((x) => x.id_member_profile);
  }
}
module.exports = CourseMemberStorage;
```

- [ ] **Step 3: CoursesService — qualquer membro cria curso no clan + anexa; valida ≥1**

No `create`/`update` do curso, quando `profile_id` é um clan: permitir qualquer **membro** do clan (via `ClanStorage.getUserMembership`), validar `member_profile_ids ⊆ membros do clan`, exigir ≥1, e gravar via `CourseMemberStorage.setMembers`.

- [ ] **Step 4: CoursesService.confirmStripeSession — split do curso de clan**

Em `confirmStripeSession`, após `upsertEnrollment`, se o curso é de clan, dividir o líquido entre anexados no `tb_clan_payout`:

```js
    const course = await CoursesStorage.getById(pool, courseId);
    const profile = course?.profile_id ? await ProfileStorage.getProfileById(pool, course.profile_id) : null;
    if (profile?.is_clan && !(await ClanPayoutStorage.existsForSource(pool, "clan_course", enrollment.id))) {
      const memberIds = await CourseMemberStorage.getMemberIds(pool, courseId);
      if (memberIds.length > 0 && amount > 0) {
        const owners = await ProfileStorage.getOwnerUserMap(pool, memberIds);
        const N = memberIds.length;
        const per = Math.floor(amount / N);
        const remainder = amount - per * N;
        const rows = memberIds.map((id_member_profile, idx) => ({
          id_member_profile,
          id_owner_user: owners[id_member_profile],
          amount_cents: per + (idx === 0 ? remainder : 0),
        }));
        await ClanPayoutStorage.createSplits(pool, {
          id_clan_profile: course.profile_id,
          source_type: "clan_course",
          source_id: String(enrollment.id),
          gross_cents: amount,
          rows,
        });
      }
    }
```

(`amount` = `seller_amount_cents`, já pós-taxa. Confere se `CoursesStorage.upsertEnrollment` retorna `id`; senão usar `courseId+userId` como source_id composto.)

- [ ] **Step 5: Lint + commit + push**

```bash
git add src/databases/migrations/125_course_members.sql src/storages/CourseMemberStorage.js src/services/CoursesService.js
git commit -m "feat(clans): slice 4 — anexar perfis em curso + split do curso no Saldo"
git push origin main
```

---

## Slice 5 — Bees espelhadas + ocultar bee

**Files:**
- Modify: `src/storages/PortfolioStorage.js` (`listAggregatedItemsForClanPublic`), `src/services/ClanService.js` (hide aceita bee)

- [ ] **Step 1: Estender a agregação pra incluir bees**

Em `PortfolioStorage.listAggregatedItemsForClanPublic`, garantir que a UNION dos itens dos membros inclui `feed_kind='bee'` (hoje pode filtrar só post). Conferir o filtro `feed_kind` e remover a exclusão de bee, mantendo `is_clan_self` e `author_*`.

- [ ] **Step 2: Hide cobre bee**

`tb_clan_hidden_post` referencia `id_portfolio_item` (bee é portfolio item com `feed_kind='bee'`), então `hidePost/unhidePost` já cobrem bee sem schema novo. Só ajustar a validação no `ClanService.hidePost` pra não restringir por kind.

- [ ] **Step 3: Lint + commit + push**

```bash
git add src/storages/PortfolioStorage.js src/services/ClanService.js
git commit -m "feat(clans): slice 5 — bees espelhadas no feed do clan + ocultar bee"
git push origin main
```

---

## Slice 6 — Chat de grupo fixado

**Files:**
- Create: `src/databases/migrations/127_clan_group_chat.sql`
- Modify: `src/services/ClanService.js`, `src/services/GroupConversationService.js`

- [ ] **Step 1: Migration — ligação conversa↔clan**

Create `src/databases/migrations/127_clan_group_chat.sql` (ajustar nome da tabela de conversa de grupo ao schema real — provável `tb_conversation` com `kind='group'`):

```sql
ALTER TABLE public.tb_conversation
  ADD COLUMN IF NOT EXISTS id_clan_profile UUID REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_clan_unique
  ON public.tb_conversation (id_clan_profile)
  WHERE id_clan_profile IS NOT NULL;
```

- [ ] **Step 2: GroupConversationService — helpers de sync**

Adicionar `createClanGroup(clanProfileId, memberUserIds)`, `addMemberToClanGroup(clanProfileId, userId)`, `removeMemberFromClanGroup(clanProfileId, userId)` reusando a lógica de grupo existente. A conversa de clan é marcada `id_clan_profile` (fixa no topo via esse flag).

- [ ] **Step 3: ClanService — criar grupo ao criar clan + sincronizar**

No `create` (após COMMIT, fire-and-forget), chamar `GroupConversationService.createClanGroup`. Em `respondInvite` (accept) → `addMemberToClanGroup`. Em `removeMember` → `removeMemberFromClanGroup`.

- [ ] **Step 4: Aposentar `tb_clan_message`**

Remover os endpoints/UI de mural (`postMessage/listMessages/deleteMessage` do clan) ou deixá-los retornando vazio; tirar do frontend no slice 8. Sem migration (tabela fica parada).

- [ ] **Step 5: Frontend /mensagens — fixar conversa de clan no topo**

Marcar conversas com `id_clan_profile` como fixadas (pin) no topo da inbox.

- [ ] **Step 6: Lint + commit + push (back) / commit + push (front)**

---

## Slice 7 — Bloqueio de afiliado para clans

**Files:**
- Modify: `src/services/StripeWebhookService.js` (`maybeAttributeCouponCommission`)

> Produto já é bloqueado em `ProfileProductService` ("Clans não podem ter loja de produtos"). Nada a fazer ali.

- [ ] **Step 1: Skip de comissão quando a venda é de clan**

Em `maybeAttributeCouponCommission`, antes de atribuir comissão, resolver o perfil-fonte da venda (serviço/curso) e, se `is_clan`, retornar sem atribuir:

```js
  // Clans não geram comissão de afiliado
  const sourceProfileId = meta.id_profile || meta.profile_id || null;
  if (sourceProfileId) {
    const pr = await conn.query(`SELECT is_clan FROM public.tb_profile WHERE id_profile = $1`, [sourceProfileId]);
    if (pr.rows[0]?.is_clan) return;
  }
```

(Conferir quais `meta.*` carregam o id do perfil em cada tipo: `course_purchase`, `booking_deposit`.)

- [ ] **Step 2: Lint + commit + push**

```bash
git add src/services/StripeWebhookService.js
git commit -m "feat(clans): slice 7 — venda de clan não gera comissão de afiliado"
git push origin main
```

---

## Slice 8 — Frontend

**Files (frontend, paths com espaço — quotar):**
- `app/(header-only)/account/clans/[id_profile]/page.tsx`
- editor de curso (anexar perfis)
- `components/freelancer/freelancer-profile-view.tsx` (aba Bees espelhada, co-autoria)
- `/mensagens` (pin de conversa de clan)

- [ ] **Step 1: Gerenciar clan — criar serviço/curso + anexar membros**

Na página de gerenciar do clan, qualquer membro vê "Criar serviço" e "Criar curso", com multi-select de membros do clan pra anexar (≥1). Mostrar saldo gerado pelo clan (lista de `tb_clan_payout` do membro logado).

- [ ] **Step 2: Co-autoria nos itens**

Serviço/curso de clan mostram chips dos perfis anexados (avatar+@username).

- [ ] **Step 3: Aba Bees espelhada na página do clan**

`freelancer-profile-view kind="clan"` ganha aba Bees agregada (igual posts), com atribuição de autor.

- [ ] **Step 4: Chat de clan fixado**

Remover UI do mural antigo; conversa de grupo do clan aparece fixada no topo do /mensagens.

- [ ] **Step 5: Commit + push (front, sem `git add -A` — só caminhos da feature)**

---

## Self-Review (cobertura do spec)

- Decisão 1 (aba Clans, não picker) → slice 8 ✅
- Decisão 2 (ancorado a dono, herda is_paid) → já existe; slices 1/3 preservam ✅
- Decisão 3 (posts+bees agregados) → slice 5 ✅
- Decisão 4 (qualquer membro cria; criador edita; dono modera) → slice 2 ✅
- Decisão 5 (anexar livre, só membros, ≥1) → slices 2 e 4 ✅
- Decisão 6 (split igual → Saldo 8d, sem afiliado) → slices 3, 4, 7 ✅
- Decisão 7 (sem produto/afiliado) → produto já bloqueado; afiliado slice 7 ✅
- Decisão 8 (chat grupo fixado, aposenta mural) → slice 6 ✅
- Decisão 9 (pontuação média) → sem mudança ✅
- Decisão 10 (1 clan por usuário) → slice 1 ✅

## Pontos a confirmar na execução (não bloqueiam o plano)

- Nome real da tabela de conversa de grupo (slice 6) — conferir `GroupConversationService`/migration de chat (mig 058) antes de escrever a 127.
- `CoursesStorage.upsertEnrollment` retorna `id`? Se não, usar source_id composto `courseId:userId` no split de curso.
- Onde o cron de release de Saldo roda (heartbeat) — plugar `ClanPayoutStorage.releaseDue` no mesmo lugar do `BookingPayoutStorage.releaseDue`.
