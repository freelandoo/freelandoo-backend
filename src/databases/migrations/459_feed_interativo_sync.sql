-- =============================================================================
-- Migration 459 — Feed Interativo F6: Feed sincronizado (assistir junto)
-- =============================================================================
-- Uma sessão entre duas contas: o anfitrião (host) convida, o convidado (guest)
-- aceita, e os dois veem o MESMO feed — o do anfitrião — andando junto. O
-- estado (qual post, vídeo tocando e em que segundo) passa só pelo socket
-- (sala sync:<id>); o banco guarda a sessão, não o rastro.
--   status  invited (expira em 2 min) → active → ended
--   control host (só o anfitrião conduz) | shared (os dois conduzem)
-- Só entre quem já tem vínculo de lançar ativo em algum sentido (mig 456).
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_feed_sync_session (
  id_session   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_host      UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_guest     UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'invited',
  control      TEXT NOT NULL DEFAULT 'host',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at  TIMESTAMPTZ NULL,
  ended_at     TIMESTAMPTZ NULL,
  ended_by     UUID NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  CONSTRAINT tb_feed_sync_not_self_chk CHECK (id_host <> id_guest)
);
ALTER TABLE public.tb_feed_sync_session DROP CONSTRAINT IF EXISTS tb_feed_sync_status_chk;
ALTER TABLE public.tb_feed_sync_session
  ADD CONSTRAINT tb_feed_sync_status_chk CHECK (status IN ('invited', 'active', 'ended'));
ALTER TABLE public.tb_feed_sync_session DROP CONSTRAINT IF EXISTS tb_feed_sync_control_chk;
ALTER TABLE public.tb_feed_sync_session
  ADD CONSTRAINT tb_feed_sync_control_chk CHECK (control IN ('host', 'shared'));

CREATE INDEX IF NOT EXISTS idx_feed_sync_open
  ON public.tb_feed_sync_session (id_host, id_guest)
  WHERE status IN ('invited', 'active');
CREATE INDEX IF NOT EXISTS idx_feed_sync_recent
  ON public.tb_feed_sync_session (id_host, created_at DESC);
