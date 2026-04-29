-- =============================================================================
-- Migration 016: Sistema de Clans
-- Clan = perfil especial (is_clan=TRUE) ligado a uma máquina (sem categoria).
-- Membros são sub-perfis (id_profile), 1 sub-perfil em no máximo 1 clan.
-- 3 vagas grátis + até 3 vagas pagas (R$50 one-time cada).
-- Splits de ganhos registrados (Opção B — payout via Connect futuro).
-- =============================================================================

BEGIN;

-- ─── 1. Estende tb_profile com flag de clan e máquina direta ────────────────
ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS is_clan    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS id_machine INTEGER NULL REFERENCES public.tb_machine(id_machine);

ALTER TABLE public.tb_profile
  ALTER COLUMN id_category DROP NOT NULL;

ALTER TABLE public.tb_profile
  DROP CONSTRAINT IF EXISTS chk_profile_clan_taxonomy;
ALTER TABLE public.tb_profile
  ADD CONSTRAINT chk_profile_clan_taxonomy CHECK (
    (is_clan = FALSE AND id_category IS NOT NULL) OR
    (is_clan = TRUE  AND id_machine  IS NOT NULL AND id_category IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_tb_profile_clan_machine
  ON public.tb_profile (id_machine)
  WHERE is_clan = TRUE AND deleted_at IS NULL;

-- ─── 2. Configurações do clan (slots e preço) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_clan_settings (
  id_profile        UUID         PRIMARY KEY REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  free_slots        INT          NOT NULL DEFAULT 3 CHECK (free_slots >= 0),
  paid_slots        INT          NOT NULL DEFAULT 0 CHECK (paid_slots >= 0 AND paid_slots <= 3),
  slot_price_cents  INT          NOT NULL DEFAULT 5000 CHECK (slot_price_cents >= 0),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── 3. Membros do clan ─────────────────────────────────────────────────────
-- UNIQUE(id_member_profile) garante: 1 sub-perfil em no máximo 1 clan.
CREATE TABLE IF NOT EXISTS public.tb_clan_member (
  id_clan_profile    UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_member_profile  UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  role               VARCHAR(16)  NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_clan_profile, id_member_profile),
  UNIQUE (id_member_profile)
);

CREATE INDEX IF NOT EXISTS idx_clan_member_clan
  ON public.tb_clan_member (id_clan_profile);

-- Garante exatamente 1 owner por clan
CREATE UNIQUE INDEX IF NOT EXISTS idx_clan_member_owner_unique
  ON public.tb_clan_member (id_clan_profile)
  WHERE role = 'owner';

-- ─── 4. Convites ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_clan_invite (
  id_clan_invite       BIGSERIAL    PRIMARY KEY,
  id_clan_profile      UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_invited_profile   UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_invited_by_user   UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  status               VARCHAR(16)  NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','accepted','declined','canceled','expired')),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  responded_at         TIMESTAMPTZ  NULL,
  expires_at           TIMESTAMPTZ  NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clan_invite_pending_unique
  ON public.tb_clan_invite (id_clan_profile, id_invited_profile)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_clan_invite_invited_pending
  ON public.tb_clan_invite (id_invited_profile)
  WHERE status = 'pending';

-- ─── 5. Compras de vagas (one-time R$50 por vaga) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_clan_slot_purchase (
  id_clan_slot_purchase     BIGSERIAL    PRIMARY KEY,
  id_clan_profile           UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user_payer             UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE RESTRICT,
  stripe_session_id         VARCHAR(255) NULL,
  stripe_payment_intent_id  VARCHAR(255) NULL,
  amount_cents              INT          NOT NULL,
  currency                  VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  status                    VARCHAR(16)  NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','paid','canceled','failed','refunded')),
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  paid_at                   TIMESTAMPTZ  NULL
);

CREATE INDEX IF NOT EXISTS idx_clan_slot_purchase_clan
  ON public.tb_clan_slot_purchase (id_clan_profile);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clan_slot_purchase_session
  ON public.tb_clan_slot_purchase (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

-- ─── 6. Quadro de mensagens do clan ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_clan_message (
  id_clan_message    BIGSERIAL    PRIMARY KEY,
  id_clan_profile    UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user            UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_member_profile  UUID         NULL REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL,
  content            TEXT         NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ  NULL
);

CREATE INDEX IF NOT EXISTS idx_clan_message_clan_recent
  ON public.tb_clan_message (id_clan_profile, created_at DESC)
  WHERE deleted_at IS NULL;

-- ─── 7. Splits de ganhos (Opção B — registra divisão, payout futuro) ────────
CREATE TABLE IF NOT EXISTS public.tb_clan_earning_split (
  id_clan_earning_split  BIGSERIAL    PRIMARY KEY,
  id_clan_profile        UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_member_profile      UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE RESTRICT,
  source_type            VARCHAR(32)  NOT NULL,
  source_id              VARCHAR(64)  NULL,
  gross_amount_cents     INT          NOT NULL,
  amount_cents           INT          NOT NULL,
  currency               VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  status                 VARCHAR(16)  NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','paid_out','canceled','failed')),
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  paid_out_at            TIMESTAMPTZ  NULL
);

CREATE INDEX IF NOT EXISTS idx_clan_split_clan
  ON public.tb_clan_earning_split (id_clan_profile, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clan_split_member_pending
  ON public.tb_clan_earning_split (id_member_profile, status, created_at DESC);

COMMIT;
