-- 451 — Meu Mundo, trilha E, fatia E19: EVENTOS ligados pelo admin.
-- Idempotente. Uma linha por evento do catálogo (mmItems/catalog/events.js). Ligado (e antes de
-- `ends_at`, quando houver) = toda atividade validada paga `ficha_evento` e a loja de evento abre.

CREATE TABLE IF NOT EXISTS public.tb_mm_event (
  id TEXT PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  ends_at TIMESTAMPTZ NULL,
  updated_by UUID NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
