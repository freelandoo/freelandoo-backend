-- =============================================================================
-- Migration 061: Contas Supervisionadas (menores de 18 vinculados a responsável)
-- =============================================================================
-- - tb_user ganha is_minor + responsible_user_id (denormalização para checks
--   rápidos em guards públicos como vitrine/ranking).
-- - parental_invites: códigos gerados pelo responsável; 24h, single-use, podem
--   ser revogados antes de uso.
-- - supervised_accounts: vínculo 1:1 menor→responsável (1 menor tem 1 resp.;
--   1 resp. pode ter N menores).
-- - minor_permissions: toggles granulares (defaults conservadores; bloqueios
--   duros como vitrine/ranking/serviço/mural seguem proibidos no backend
--   mesmo se o flag estiver TRUE).
-- - minor_machine_access: lista positiva (allowed=TRUE) das máquinas que o
--   responsável liberou para o menor. Sem registro = bloqueado.
-- =============================================================================

BEGIN;

-- 1) Flags de menor + vínculo direto em tb_user (denormalização)
ALTER TABLE public.tb_user
  ADD COLUMN IF NOT EXISTS is_minor BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.tb_user
  ADD COLUMN IF NOT EXISTS responsible_user_id UUID NULL
    REFERENCES public.tb_user(id_user) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_tb_user_responsible
  ON public.tb_user (responsible_user_id)
  WHERE responsible_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_tb_user_is_minor
  ON public.tb_user (is_minor)
  WHERE is_minor = TRUE;

-- 2) Códigos do responsável (24h, single-use, revogável)
CREATE TABLE IF NOT EXISTS public.parental_invites (
  id_invite           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  responsible_user_id UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  code                VARCHAR(16) NOT NULL UNIQUE,
  status              VARCHAR(16) NOT NULL DEFAULT 'active',
  expires_at          TIMESTAMPTZ NOT NULL,
  used_at             TIMESTAMPTZ NULL,
  used_by_user_id     UUID NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  revoked_at          TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.parental_invites
  DROP CONSTRAINT IF EXISTS parental_invites_status_chk;
ALTER TABLE public.parental_invites
  ADD CONSTRAINT parental_invites_status_chk
  CHECK (status IN ('active','used','revoked','expired'));

CREATE INDEX IF NOT EXISTS ix_parental_invites_responsible
  ON public.parental_invites (responsible_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_parental_invites_active
  ON public.parental_invites (code)
  WHERE status = 'active';

-- 3) Vínculo menor↔responsável (1 ativo por menor)
CREATE TABLE IF NOT EXISTS public.supervised_accounts (
  id_supervised        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  minor_user_id        UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  responsible_user_id  UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  invite_id            UUID NULL REFERENCES public.parental_invites(id_invite) ON DELETE SET NULL,
  relationship         VARCHAR(40) NULL,
  status               VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.supervised_accounts
  DROP CONSTRAINT IF EXISTS supervised_accounts_status_chk;
ALTER TABLE public.supervised_accounts
  ADD CONSTRAINT supervised_accounts_status_chk
  CHECK (status IN ('active','suspended','revoked'));

-- Apenas 1 vínculo ativo por menor
CREATE UNIQUE INDEX IF NOT EXISTS ux_supervised_minor_active
  ON public.supervised_accounts (minor_user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ix_supervised_responsible
  ON public.supervised_accounts (responsible_user_id, status);

-- 4) Permissões granulares
CREATE TABLE IF NOT EXISTS public.minor_permissions (
  minor_user_id          UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  can_view_feed          BOOLEAN NOT NULL DEFAULT TRUE,
  can_post_feed          BOOLEAN NOT NULL DEFAULT TRUE,
  can_use_bees           BOOLEAN NOT NULL DEFAULT TRUE,
  can_watch_courses      BOOLEAN NOT NULL DEFAULT TRUE,
  can_sell_courses       BOOLEAN NOT NULL DEFAULT FALSE,
  can_message            BOOLEAN NOT NULL DEFAULT TRUE,
  can_receive_messages   BOOLEAN NOT NULL DEFAULT TRUE,
  can_use_global_chat    BOOLEAN NOT NULL DEFAULT FALSE,
  can_use_machine_chat   BOOLEAN NOT NULL DEFAULT FALSE,
  can_request_service    BOOLEAN NOT NULL DEFAULT FALSE,
  can_show_in_showcase   BOOLEAN NOT NULL DEFAULT FALSE,
  can_show_in_ranking    BOOLEAN NOT NULL DEFAULT FALSE,
  can_have_mural         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5) Acesso a máquinas (lista positiva)
CREATE TABLE IF NOT EXISTS public.minor_machine_access (
  id_access      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  minor_user_id  UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_machine     INTEGER NOT NULL REFERENCES public.tb_machine(id_machine) ON DELETE CASCADE,
  allowed        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (minor_user_id, id_machine)
);

CREATE INDEX IF NOT EXISTS ix_minor_machine_access_user
  ON public.minor_machine_access (minor_user_id);

COMMIT;
