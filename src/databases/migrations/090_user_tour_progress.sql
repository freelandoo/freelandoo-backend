CREATE TABLE IF NOT EXISTS public.user_tour_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  tour_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  current_step INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ NULL,
  skipped_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_tour_progress_status_chk
    CHECK (status IN ('not_started', 'in_progress', 'completed', 'skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_tour_progress_user_tour
  ON public.user_tour_progress (user_id, tour_key);

CREATE INDEX IF NOT EXISTS ix_user_tour_progress_user_status
  ON public.user_tour_progress (user_id, status);
