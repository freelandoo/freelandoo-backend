-- =============================================================================
-- Migration 084: cria tb_user_media (faltava no schema)
-- =============================================================================
-- UserMediaController consulta tb_user_media mas nenhuma migration criava a
-- tabela. Resultado: GET /users/me/media retorna 500 ("relation does not
-- exist"). Mig 028 só ALTERA condicionalmente — não cria.
--
-- Tabela é portfolio de mídia geral por user (separado de portfolio de
-- subperfil). Idempotente.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_user_media (
  id_media        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user         UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  title           VARCHAR(160) NULL,
  description     TEXT NULL,
  media_url       TEXT NOT NULL,
  media_type      VARCHAR(20) NOT NULL DEFAULT 'image',
  external_link   TEXT NULL,
  position        INTEGER NOT NULL DEFAULT 0,
  original_filename TEXT NULL,
  mime_type       VARCHAR(100) NULL,
  width           INTEGER NULL,
  height          INTEGER NULL,
  size_bytes      INTEGER NULL,
  duration_seconds NUMERIC NULL,
  storage_key     TEXT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_user_media_user_position
  ON public.tb_user_media (id_user, position, created_at DESC);

COMMIT;
