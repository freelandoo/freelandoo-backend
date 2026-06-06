-- =============================================================================
-- Migration 131: textos editáveis das home (slot -> conteúdo)
-- =============================================================================
-- Espelha tb_site_asset, mas guarda texto em vez de URL. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_site_text (
  slot_key    VARCHAR(60)  PRIMARY KEY,
  content     TEXT         NOT NULL,
  updated_by  UUID         REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
