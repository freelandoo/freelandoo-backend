-- 447 — MEU MUNDO 3D, lore v2 N4: o deus solto.
--
-- Estátua cheia no domingo (mig 442, tb_mm_statue_week.full_at) → na semana
-- seguinte o deus daquele povo anda e caça a raça oposta (rua e Domínios).
-- Uma linha por caçada: solta em `loose_at` (fim do domingo, Brasília), o
-- aviso de "solto" sai uma vez (`announced_at`), e a PRIMEIRA vitória
-- conferida grava quem venceu e a luta (`id_fight` único) e encerra para todos.
-- `source` 'statue' = veio da estátua (uma por domingo × povo); 'admin' = o
-- admin soltou para conferir. Regra em utils/meuMundoGodHunt.js. Idempotente.

CREATE TABLE IF NOT EXISTS public.tb_mm_god_hunt (
  id_hunt BIGSERIAL PRIMARY KEY,
  week DATE NULL,
  clan TEXT NOT NULL,
  god TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'statue',
  loose_at TIMESTAMPTZ NOT NULL,
  announced_at TIMESTAMPTZ NULL,
  defeated_at TIMESTAMPTZ NULL,
  id_user UUID NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  id_fight UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mm_god_hunt_clan CHECK (clan IN ('raposa', 'vampiro')),
  CONSTRAINT chk_mm_god_hunt_god CHECK (god IN ('aurion', 'morkhan')),
  CONSTRAINT chk_mm_god_hunt_source CHECK (source IN ('statue', 'admin')),
  CONSTRAINT chk_mm_god_hunt_week CHECK (week IS NULL OR EXTRACT(DOW FROM week) = 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_god_hunt_week ON public.tb_mm_god_hunt (week, clan) WHERE week IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_god_hunt_fight ON public.tb_mm_god_hunt (id_fight) WHERE id_fight IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mm_god_hunt_open ON public.tb_mm_god_hunt (clan, loose_at) WHERE defeated_at IS NULL;

-- A luta contra o deus solto é uma origem própria do ticket (superset do CHECK da 444).
ALTER TABLE public.tb_mm_fight DROP CONSTRAINT IF EXISTS chk_mm_fight_origin;
ALTER TABLE public.tb_mm_fight
  ADD CONSTRAINT chk_mm_fight_origin CHECK (origin IN ('laminas', 'boxe', 'mob', 'tutorial', 'hall', 'domain', 'god'));
