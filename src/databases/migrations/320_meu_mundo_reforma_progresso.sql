-- 320 — MEU MUNDO 3D mm3d-59 (reforma, slice 2): DESTREZA, orçamento diário,
-- XP de aventura, RECIBOS e tickets de luta.
--
-- Plano: MEU MUNDO 3D/planos/2026-11-02-mm3d-59-reforma.md. Regras em
-- src/utils/meuMundoLife.js (ATTR.BUDGET, gain) e src/utils/meuMundoAdventure.js.
--
-- Destreza: quem já existe recebe o que teria ao nascer (15 + semente mod 16,
-- a mesma conta do nascimento) — nenhum ganho retroativo inventado.
-- Recibo: a ÚNICA porta de concessão (XP, atributo, moedas, itens). Um por
-- (personagem, origem, ação): o reenvio devolve o mesmo, sem conceder de novo.

ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS dexterity DOUBLE PRECISION NULL;
UPDATE public.tb_mm_character SET dexterity = 15 + (abs(seed) % 16) WHERE dexterity IS NULL;
UPDATE public.tb_mm_character
   SET attr_peaks = attr_peaks || jsonb_build_object('dexterity', dexterity)
 WHERE attr_peaks IS NOT NULL AND NOT (attr_peaks ? 'dexterity');
ALTER TABLE public.tb_mm_character ALTER COLUMN dexterity SET DEFAULT 20;
ALTER TABLE public.tb_mm_character ALTER COLUMN dexterity SET NOT NULL;

-- Pontos-base já gastos por dia de Brasília: {"days":{"2026-11-02":{"strength":3.2}}}
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS attr_budget JSONB NULL;

-- XP de aventura: por PESSOA (atravessa gerações, como as moedas e a classe).
CREATE TABLE IF NOT EXISTS public.tb_mm_adventure (
  id_user UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  xp BIGINT NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  -- derrotas seguidas no dia (proteção contra o ciclo derrota → cansaço → derrota)
  losses_day DATE NULL,
  losses INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mm_adventure_xp CHECK (xp >= 0),
  CONSTRAINT chk_mm_adventure_level CHECK (level >= 1)
);

CREATE TABLE IF NOT EXISTS public.tb_mm_receipt (
  id_receipt UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_character UUID NOT NULL REFERENCES public.tb_mm_character(id_character) ON DELETE CASCADE,
  source TEXT NOT NULL,
  action_key TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  active_ms INTEGER NOT NULL DEFAULT 0,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  deltas JSONB NOT NULL DEFAULT '{}'::jsonb,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_mm_receipt_action UNIQUE (id_character, source, action_key),
  CONSTRAINT chk_mm_receipt_active CHECK (active_ms >= 0)
);
CREATE INDEX IF NOT EXISTS ix_mm_receipt_user_at ON public.tb_mm_receipt (id_user, created_at DESC);

-- Ticket de luta: o SERVIDOR sorteia a semente e guarda com o que a luta abre;
-- o fim re-simula a entrada gravada (src/utils/meuMundoFight.js, gerado).
CREATE TABLE IF NOT EXISTS public.tb_mm_fight (
  id_fight UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_character UUID NOT NULL REFERENCES public.tb_mm_character(id_character) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  setup JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_mm_fight_origin CHECK (origin IN ('laminas', 'boxe', 'mob', 'tutorial'))
);
CREATE INDEX IF NOT EXISTS ix_mm_fight_open ON public.tb_mm_fight (id_user) WHERE closed_at IS NULL;
