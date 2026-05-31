-- =============================================================================
-- Migration 107: Biblioteca de áudio (música pro composer unificado)
-- =============================================================================
-- Catálogo de faixas curado pelo admin (royalty-free), guardado no R2 sob o
-- prefixo audio-library/. O usuário escolhe uma faixa no editor de Post/Bee/Story
-- e ela fica ANEXADA como metadado (slice 108) — o player toca; nada é queimado.
-- Pode nascer vazia. Idempotente: CREATE TABLE IF NOT EXISTS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_audio_track (
  id_audio_track  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title           VARCHAR(160) NOT NULL,
  artist          VARCHAR(160),
  storage_key     TEXT         NOT NULL,       -- key no R2 (audio-library/...)
  cover_key       TEXT,                        -- capa opcional no R2
  duration_ms     INTEGER      NOT NULL DEFAULT 0,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order      INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audio_track_active
  ON public.tb_audio_track (is_active, sort_order ASC, created_at DESC)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_audio_track_title
  ON public.tb_audio_track (lower(title));
