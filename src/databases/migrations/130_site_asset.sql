-- =============================================================================
-- Migration 130: imagens editáveis das home (slot -> url no R2)
-- =============================================================================
-- Cada slot_key (ex.: home_buyer_hero) mapeia para a URL pública de uma imagem
-- no R2, trocável pelo admin. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_site_asset (
  slot_key    VARCHAR(60)  PRIMARY KEY,
  image_url   TEXT         NOT NULL,
  updated_by  UUID         REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
