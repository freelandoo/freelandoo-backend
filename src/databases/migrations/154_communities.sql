-- =============================================================================
-- Migration 154: Comunidades (substituem Clans)
-- Comunidade = novo tipo em tb_profile (is_community=TRUE), ligada a um enxame
-- (id_machine, sem id_category), com página própria (feed/bees por id_profile).
-- Membros são USERS (não subperfis). Tetos de criação/participação por user.
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

-- ─── 1. Estende tb_profile com o tipo comunidade ────────────────────────────
ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS is_community    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS community_theme JSONB   NULL,
  ADD COLUMN IF NOT EXISTS id_leader_user  UUID    NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL;

-- Comunidade segue a regra de taxonomia do clan (id_machine sem id_category).
ALTER TABLE public.tb_profile DROP CONSTRAINT IF EXISTS chk_profile_clan_taxonomy;
ALTER TABLE public.tb_profile ADD CONSTRAINT chk_profile_clan_taxonomy CHECK (
  ( is_clan = FALSE AND is_community = FALSE AND id_category IS NOT NULL ) OR
  ( is_clan = TRUE  AND id_machine  IS NOT NULL AND id_category IS NULL ) OR
  ( is_community = TRUE AND id_machine IS NOT NULL AND id_category IS NULL )
);

CREATE INDEX IF NOT EXISTS idx_tb_profile_community
  ON public.tb_profile (id_machine)
  WHERE is_community = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tb_profile_leader_user
  ON public.tb_profile (id_leader_user)
  WHERE is_community = TRUE AND deleted_at IS NULL;

-- ─── 2. Membros (user-level). role: leader | vice | member ──────────────────
CREATE TABLE IF NOT EXISTS public.tb_community_member (
  id_community_profile UUID        NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user              UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  role                 VARCHAR(16) NOT NULL DEFAULT 'member' CHECK (role IN ('leader','vice','member')),
  joined_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_community_profile, id_user)
);

CREATE INDEX IF NOT EXISTS idx_community_member_user
  ON public.tb_community_member (id_user);

-- Exatamente 1 líder por comunidade.
CREATE UNIQUE INDEX IF NOT EXISTS ux_community_one_leader
  ON public.tb_community_member (id_community_profile)
  WHERE role = 'leader';

-- ─── 3. Tetos por user (default 1 criar / 1 entrar; bundle sobe +1/+1) ──────
CREATE TABLE IF NOT EXISTS public.tb_community_entitlement (
  id_user     UUID        PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  create_cap  INT         NOT NULL DEFAULT 1 CHECK (create_cap BETWEEN 1 AND 3),
  member_cap  INT         NOT NULL DEFAULT 1 CHECK (member_cap BETWEEN 1 AND 3),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 4. Compras do bundle R$100 (idempotente por stripe_session_id) ─────────
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
  ON public.tb_community_slot_purchase (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_community_slot_payer
  ON public.tb_community_slot_purchase (id_user_payer, created_at DESC);
