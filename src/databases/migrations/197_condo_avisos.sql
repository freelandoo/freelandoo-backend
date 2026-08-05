-- =============================================================================
-- Migration 197: Avisos do condomínio + tipos de notificação
-- Aviso = recado do morador/administrador dentro do condomínio. Pode ser GERAL
-- (todo mundo vê no mural de avisos) ou DIRECIONADO a uma unidade ou a uma vaga
-- — nesse caso o responsável pela unidade/vaga recebe NOTIFICAÇÃO.
--
-- O CHECK de tb_notification é reescrito como SUPERSET completo (regra fixada
-- pela mig 153: nunca um subconjunto, senão tipos antigos passam a falhar
-- silenciosamente no insert em try/catch).
-- Idempotente.
-- =============================================================================

-- ─── 1. Aviso ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_condo_notice (
  id_notice    BIGSERIAL     PRIMARY KEY,
  id_condo     UUID          NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_author    UUID          NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  scope        VARCHAR(10)   NOT NULL CHECK (scope IN ('general', 'unit', 'parking')),
  id_unit      BIGINT        NULL REFERENCES public.tb_condo_unit(id_unit) ON DELETE CASCADE,
  id_spot      BIGINT        NULL REFERENCES public.tb_condo_parking(id_spot) ON DELETE CASCADE,
  title        VARCHAR(120)  NULL,
  body         VARCHAR(2000) NOT NULL,
  is_pinned    BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ   NULL
);

ALTER TABLE public.tb_condo_notice DROP CONSTRAINT IF EXISTS chk_condo_notice_target;
ALTER TABLE public.tb_condo_notice ADD CONSTRAINT chk_condo_notice_target CHECK (
  (scope = 'general' AND id_unit IS NULL     AND id_spot IS NULL) OR
  (scope = 'unit'    AND id_unit IS NOT NULL AND id_spot IS NULL) OR
  (scope = 'parking' AND id_spot IS NOT NULL AND id_unit IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_condo_notice_feed
  ON public.tb_condo_notice (id_condo, created_at DESC)
  WHERE deleted_at IS NULL;

-- Caixa do morador: avisos direcionados às unidades/vagas dele.
CREATE INDEX IF NOT EXISTS idx_condo_notice_unit
  ON public.tb_condo_notice (id_unit, created_at DESC)
  WHERE id_unit IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_condo_notice_spot
  ON public.tb_condo_notice (id_spot, created_at DESC)
  WHERE id_spot IS NOT NULL AND deleted_at IS NULL;

-- ─── 2. Leitura do aviso direcionado (para o "não lidos" do morador) ────────
CREATE TABLE IF NOT EXISTS public.tb_condo_notice_read (
  id_notice BIGINT      NOT NULL REFERENCES public.tb_condo_notice(id_notice) ON DELETE CASCADE,
  id_user   UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  read_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_notice, id_user)
);

-- ─── 3. CHECK de tb_notification — SUPERSET (mig 153 + condomínio) ──────────
ALTER TABLE public.tb_notification
  DROP CONSTRAINT IF EXISTS tb_notification_type_chk;

ALTER TABLE public.tb_notification
  ADD CONSTRAINT tb_notification_type_chk
  CHECK (type IN (
    -- social (057)
    'like_received',
    'comment_received',
    'follow_received',
    'message_received',
    -- supervisão (062)
    'supervised_message_received',
    'parental_permission_request',
    -- pedidos de produto (071)
    'product_request_new',
    'product_response_new',
    -- comercial (152 / slice C)
    'product_sale',
    'course_sale',
    'booking_received',
    -- chamados / O.S. (slice D)
    'service_response_received',
    'chamado_match',
    -- financeiro (slice E)
    'affiliate_commission_released',
    'subscription_expiring',
    'premium_expiring',
    'manifestation_expiring',
    -- social extra (slice F)
    'live_started',
    'clan_invite',
    'clan_member_joined',
    'live_gift_received',
    -- condomínio (196/197)
    'condo_claim_pending',
    'condo_claim_resolved',
    'condo_notice_received',
    'condo_poll_opened'
  )) NOT VALID;
