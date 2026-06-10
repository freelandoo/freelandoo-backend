-- 104 — base das tabelas do Monetization Intent (recriada na F5.S1).
--
-- Contexto: as migs 103/104 originais foram DELETADAS no revert do
-- monetization onboarding (2026-05-23), mas a mig 105 reaproveita duas das
-- tabelas que elas criavam (o IntentModal atual usa as duas). Em produção as
-- tabelas existem (criadas antes do revert); num banco VIRGEM a cadeia de
-- migrations quebrava na 105 ("tour_monetization_paths does not exist").
--
-- Este arquivo restaura só as DUAS tabelas vivas, com a definição original
-- da 103 (commit 15fdeb1). Tudo IF NOT EXISTS → no-op em produção.
-- As outras duas (tour_path_steps, user_tour_path_progress) seguem mortas —
-- a mig 141 dropa.

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
