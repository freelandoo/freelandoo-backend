-- =============================================================================
-- Migration 030: Sistema de XP e Níveis para subperfis profissionais
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Configuração global do sistema de XP (apenas uma linha — id = 1)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xp_settings (
  id                      INT          PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
  base_xp_level_1         NUMERIC      NOT NULL DEFAULT 5000,
  level_multiplier        NUMERIC      NOT NULL DEFAULT 1.4,
  profile_activation_xp   NUMERIC      NOT NULL DEFAULT 5000,
  affiliate_sale_xp       NUMERIC      NOT NULL DEFAULT 5000,
  renewal_xp              NUMERIC      NOT NULL DEFAULT 3000,
  like_received_xp        NUMERIC      NOT NULL DEFAULT 2,
  share_received_xp       NUMERIC      NOT NULL DEFAULT 20,
  follow_received_xp      NUMERIC      NOT NULL DEFAULT 15,
  whatsapp_click_xp       NUMERIC      NOT NULL DEFAULT 50,
  approved_post_xp        NUMERIC      NOT NULL DEFAULT 25,
  online_minute_xp        NUMERIC      NOT NULL DEFAULT 0.25,
  profile_visit_xp        NUMERIC      NOT NULL DEFAULT 1,
  review_received_xp      NUMERIC      NOT NULL DEFAULT 10,
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by_admin_id     UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);

INSERT INTO public.xp_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ledger de eventos de XP por subperfil
-- Cada evento preserva o xp_amount do momento — pesos futuros não o alteram.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subprofile_xp_events (
  id            BIGSERIAL    PRIMARY KEY,
  id_profile    UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  event_type    VARCHAR(40)  NOT NULL,
  source_type   VARCHAR(40)  NULL,
  source_id     VARCHAR(200) NULL,
  xp_amount     NUMERIC      NOT NULL DEFAULT 0,
  metadata      JSONB        NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Garante idempotência: mesmo source não gera XP duplicado
CREATE UNIQUE INDEX IF NOT EXISTS idx_xp_events_dedup
  ON public.subprofile_xp_events (id_profile, event_type, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_xp_events_profile
  ON public.subprofile_xp_events (id_profile, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Cache de XP e nível em tb_profile (atualizado a cada evento)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS xp_total  NUMERIC  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS xp_level  INT      NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_profile_xp_level
  ON public.tb_profile (xp_level DESC, xp_total DESC)
  WHERE is_clan = FALSE AND deleted_at IS NULL;
