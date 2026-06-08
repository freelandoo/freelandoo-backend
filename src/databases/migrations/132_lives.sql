-- =============================================================================
-- Migration 132: Lives (WebRTC via LiveKit) + Loja de Presentes
-- =============================================================================
-- Lives efêmeras: o criador transmite por WebRTC (LiveKit), os espectadores
-- assistem. NÃO há gravação — quando a live encerra, some (nada no R2).
--
-- Monetização por PRESENTES leves: catálogo gerenciável no admin. Cada presente
-- é só ícone (emoji) + cor + animação (preset CSS/GSAP) + preço em Poléns.
-- Nada de mídia pesada — a animação é renderizada no navegador.
--
--   tb_live_gift        -> catálogo de presentes (loja no admin)
--   tb_live             -> sessões de live (status live/ended, sala LiveKit)
--   tb_live_gift_event  -> presentes enviados durante uma live (gasto de Poléns)
-- =============================================================================

BEGIN;

-- ── Catálogo de presentes (loja) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_live_gift (
  id_live_gift  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(60)  NOT NULL,
  emoji         VARCHAR(16)  NOT NULL DEFAULT '🎁',
  color         VARCHAR(16)  NOT NULL DEFAULT '#F2B705',
  animation     VARCHAR(20)  NOT NULL DEFAULT 'float',
  price_polens  INTEGER      NOT NULL DEFAULT 10 CHECK (price_polens >= 0),
  sort_order    INTEGER      NOT NULL DEFAULT 0,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tb_live_gift
  DROP CONSTRAINT IF EXISTS tb_live_gift_animation_chk;
ALTER TABLE public.tb_live_gift
  ADD CONSTRAINT tb_live_gift_animation_chk
  CHECK (animation IN ('float','burst','rain','pulse','spin','slide'));

CREATE INDEX IF NOT EXISTS ix_live_gift_active_order
  ON public.tb_live_gift (is_active, sort_order);

-- Seed inicial (só se a tabela estiver vazia)
INSERT INTO public.tb_live_gift (name, emoji, color, animation, price_polens, sort_order)
SELECT * FROM (VALUES
  ('Coração',  '❤️', '#FF3B6B', 'float',  10,  1),
  ('Rosa',     '🌹', '#E0457B', 'float',  25,  2),
  ('Foguete',  '🚀', '#4F7CFF', 'slide',  100, 3),
  ('Coroa',    '👑', '#F2B705', 'burst',  500, 4)
) AS v(name, emoji, color, animation, price_polens, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.tb_live_gift);

-- ── Sessões de live ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_live (
  id_live       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_profile    UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user       UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  room_name     VARCHAR(80)  NOT NULL UNIQUE,
  title         VARCHAR(120),
  status        VARCHAR(12)  NOT NULL DEFAULT 'live',
  peak_viewers  INTEGER      NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tb_live
  DROP CONSTRAINT IF EXISTS tb_live_status_chk;
ALTER TABLE public.tb_live
  ADD CONSTRAINT tb_live_status_chk
  CHECK (status IN ('live','ended'));

-- 1 live ativa por perfil (índice parcial único)
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_active_per_profile
  ON public.tb_live (id_profile)
  WHERE status = 'live';

CREATE INDEX IF NOT EXISTS ix_live_active
  ON public.tb_live (status, started_at DESC)
  WHERE status = 'live';

-- ── Presentes enviados durante a live ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_live_gift_event (
  id              BIGSERIAL PRIMARY KEY,
  id_live         UUID NOT NULL REFERENCES public.tb_live(id_live) ON DELETE CASCADE,
  id_live_gift    UUID NOT NULL REFERENCES public.tb_live_gift(id_live_gift),
  id_sender_user  UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  polens_spent    INTEGER NOT NULL DEFAULT 0,
  message         VARCHAR(120),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_live_gift_event_live
  ON public.tb_live_gift_event (id_live, created_at DESC);

COMMIT;
