-- =============================================================================
-- Migration 108: Anexar música (composer unificado — Slice 5)
-- =============================================================================
-- A faixa escolhida no editor (mig 107 tb_audio_track) fica ANEXADA como
-- metadado a stories e posts/bees — o player toca; nada é queimado na mídia.
--   audio_track_id  → FK p/ tb_audio_track (ON DELETE SET NULL: apagar a faixa
--                     do catálogo não quebra os posts; só desliga a música).
--   audio_start_ms  → offset de início da faixa (recorte escolhido).
--   render_meta     → "receita" visual queimada (preset/filtro/texto/overlay),
--                     guardada p/ auditoria/futura re-edição. Nullable.
-- Idempotente: ADD COLUMN IF NOT EXISTS + DROP CONSTRAINT IF EXISTS antes do ADD.
-- =============================================================================

-- ─── tb_story ────────────────────────────────────────────────────────────────
ALTER TABLE public.tb_story
  ADD COLUMN IF NOT EXISTS audio_track_id UUID;
ALTER TABLE public.tb_story
  ADD COLUMN IF NOT EXISTS audio_start_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.tb_story
  ADD COLUMN IF NOT EXISTS render_meta JSONB;

ALTER TABLE public.tb_story
  DROP CONSTRAINT IF EXISTS tb_story_audio_track_fk;
ALTER TABLE public.tb_story
  ADD CONSTRAINT tb_story_audio_track_fk
  FOREIGN KEY (audio_track_id)
  REFERENCES public.tb_audio_track (id_audio_track)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_story_audio_track
  ON public.tb_story (audio_track_id)
  WHERE audio_track_id IS NOT NULL;

-- ─── tb_profile_portfolio_item (post/bee) ────────────────────────────────────
ALTER TABLE public.tb_profile_portfolio_item
  ADD COLUMN IF NOT EXISTS audio_track_id UUID;
ALTER TABLE public.tb_profile_portfolio_item
  ADD COLUMN IF NOT EXISTS audio_start_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.tb_profile_portfolio_item
  ADD COLUMN IF NOT EXISTS render_meta JSONB;

ALTER TABLE public.tb_profile_portfolio_item
  DROP CONSTRAINT IF EXISTS tb_portfolio_item_audio_track_fk;
ALTER TABLE public.tb_profile_portfolio_item
  ADD CONSTRAINT tb_portfolio_item_audio_track_fk
  FOREIGN KEY (audio_track_id)
  REFERENCES public.tb_audio_track (id_audio_track)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_portfolio_item_audio_track
  ON public.tb_profile_portfolio_item (audio_track_id)
  WHERE audio_track_id IS NOT NULL;
