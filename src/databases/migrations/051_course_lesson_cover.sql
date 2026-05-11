-- =============================================================================
-- Migration 051: Capa da aula
-- =============================================================================
-- Adiciona `cover_url` em course_lessons. Diferente do `thumbnail_url`
-- (que é gerado automaticamente pelo ffmpeg a partir do vídeo, Slice 8),
-- `cover_url` é a capa "editorial" da aula — usada nos cards 4:5 dentro
-- da página do módulo, antes de qualquer vídeo ser enviado. Idempotente.

ALTER TABLE public.course_lessons
  ADD COLUMN IF NOT EXISTS cover_url TEXT;
