-- =============================================================================
-- Migration 103: Monetization Onboarding — schema base
-- =============================================================================
-- Modal "Como você quer ganhar dinheiro?" + tours administráveis multi-página.
-- Não substitui o sistema de tour antigo (mig 090/091/095) — coexiste em
-- namespace separado (`path_key` em vez de `tour_key`).
--
-- Tabelas:
--   user_onboarding_monetization_state — 1 row por user, controla o modal
--   tour_monetization_paths            — 5 caminhos fixos administráveis
--   tour_path_steps                    — passos por caminho
--   user_tour_path_progress            — progresso de cada user por caminho

-- ---------- 1. Estado do modal por user --------------------------------------
CREATE TABLE IF NOT EXISTS public.user_onboarding_monetization_state (
  user_id              UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  dismissed_at         TIMESTAMPTZ NULL,
  dismissed_reason     TEXT NULL,
  selected_path_key    TEXT NULL,
  selected_at          TIMESTAMPTZ NULL,
  active_tour_path_key TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_onb_monet_dismiss_reason_chk
    CHECK (dismissed_reason IS NULL OR dismissed_reason IN ('later', 'no_thanks', 'closed'))
);

CREATE INDEX IF NOT EXISTS ix_user_onb_monet_selected
  ON public.user_onboarding_monetization_state (selected_path_key);

-- ---------- 2. Catálogo de caminhos ------------------------------------------
CREATE TABLE IF NOT EXISTS public.tour_monetization_paths (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path_key          TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  cta_label         TEXT NOT NULL DEFAULT 'Começar',
  banner_image_url  TEXT NULL,
  banner_object_key TEXT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  is_seed           BOOLEAN NOT NULL DEFAULT FALSE,
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tour_monet_paths_key
  ON public.tour_monetization_paths (path_key);

CREATE INDEX IF NOT EXISTS ix_tour_monet_paths_active_sort
  ON public.tour_monetization_paths (is_active, sort_order);

-- ---------- 3. Passos por caminho --------------------------------------------
CREATE TABLE IF NOT EXISTS public.tour_path_steps (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path_id            UUID NOT NULL REFERENCES public.tour_monetization_paths(id) ON DELETE CASCADE,
  step_order         INTEGER NOT NULL,
  route              TEXT NOT NULL,
  target_selector    TEXT NULL,
  wait_for_selector  TEXT NULL,
  placement          TEXT NOT NULL DEFAULT 'bottom',
  title              TEXT NOT NULL,
  content            TEXT NOT NULL,
  on_enter_action    TEXT NULL,
  on_leave_action    TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tour_path_steps_placement_chk
    CHECK (placement IN ('top', 'bottom', 'left', 'right', 'center'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tour_path_steps_path_order
  ON public.tour_path_steps (path_id, step_order);

CREATE INDEX IF NOT EXISTS ix_tour_path_steps_path
  ON public.tour_path_steps (path_id);

-- ---------- 4. Progresso por user/caminho ------------------------------------
CREATE TABLE IF NOT EXISTS public.user_tour_path_progress (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  path_key      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'not_started',
  current_step  INTEGER NOT NULL DEFAULT 0,
  path_version  INTEGER NOT NULL DEFAULT 1,
  started_at    TIMESTAMPTZ NULL,
  completed_at  TIMESTAMPTZ NULL,
  skipped_at    TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_tour_path_status_chk
    CHECK (status IN ('not_started', 'in_progress', 'completed', 'skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_tour_path_progress_user_path
  ON public.user_tour_path_progress (user_id, path_key);

CREATE INDEX IF NOT EXISTS ix_user_tour_path_progress_user_status
  ON public.user_tour_path_progress (user_id, status);
