-- 446 — MEU MUNDO 3D: instâncias de equipamento (trilha E, fatia E2, 2026-11-11).
--
-- Cada equipamento (arma, escudo, proteção, acessório) passa a ser uma INSTÂNCIA com o seu
-- `plus`, `grade` e engastes; materiais e itens de missão seguem em pilha (tb_mm_gear), agora
-- até 9.999 e com livro de movimentos (tb_mm_item_ledger).
--
-- A troca de pilha para instância é PREGUIÇOSA (`MeuMundoGearStorage.materialize`, no começo de
-- cada operação da mochila): esta migration só cria as tabelas. O banco não conhece categoria.
--
-- Diferenças em relação ao §5.3 do plano (MEU MUNDO 3D/planos/2026-11-11-itens-equipamentos-e-progressao.md):
--  • o CHECK de slot do tb_mm_loadout aceita também os 5 slots de HOJE (weapon, shield, armor,
--    acc1, acc2), senão a cópia do tb_mm_equip falharia; a E6 migra para os 8;
--  • a instância guarda `refine_failures` (o refino forge-v1 continua por peça);
--  • a proposta de refino ganha `id_instance` e perde a FK para tb_mm_gear (instância nova não
--    tem linha em tb_mm_gear); a trava "uma proposta pendente" passa a ser por instância.
-- As migrations 321, 323 e 325 não se editam. Idempotente.

CREATE TABLE IF NOT EXISTS public.tb_mm_gear_instance (
  id_instance UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  plus SMALLINT NOT NULL DEFAULT 0,
  grade SMALLINT NOT NULL DEFAULT 1,
  ascended BOOLEAN NOT NULL DEFAULT FALSE,
  awakened BOOLEAN NOT NULL DEFAULT FALSE,
  sockets JSONB NOT NULL DEFAULT '[]'::jsonb,
  affixes JSONB NOT NULL DEFAULT '{}'::jsonb,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  refine_failures SMALLINT NOT NULL DEFAULT 0,
  rules TEXT NOT NULL DEFAULT 'forge-v1',
  version BIGINT NOT NULL DEFAULT 0,
  origin TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mm_instance_plus CHECK (plus BETWEEN 0 AND 15),
  CONSTRAINT chk_mm_instance_grade CHECK (grade BETWEEN 1 AND 5),
  CONSTRAINT chk_mm_instance_failures CHECK (refine_failures BETWEEN 0 AND 3),
  CONSTRAINT chk_mm_instance_version CHECK (version >= 0)
);
CREATE INDEX IF NOT EXISTS ix_mm_instance_user ON public.tb_mm_gear_instance (id_user, item_id);

CREATE TABLE IF NOT EXISTS public.tb_mm_loadout (
  id_character UUID NOT NULL REFERENCES public.tb_mm_character(id_character) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  id_instance UUID NOT NULL REFERENCES public.tb_mm_gear_instance(id_instance) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_character, slot),
  CONSTRAINT ux_mm_loadout_instance UNIQUE (id_character, id_instance),
  CONSTRAINT chk_mm_loadout_slot CHECK (slot IN ('weapon', 'offhand', 'helm', 'chest', 'gloves', 'boots', 'amulet', 'relic',
                                                 'shield', 'armor', 'acc1', 'acc2'))
);
CREATE INDEX IF NOT EXISTS ix_mm_loadout_instance ON public.tb_mm_loadout (id_instance);

CREATE TABLE IF NOT EXISTS public.tb_mm_item_ledger (
  id BIGSERIAL PRIMARY KEY,
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  id_receipt UUID NULL REFERENCES public.tb_mm_receipt(id_receipt) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_mm_item_ledger_user ON public.tb_mm_item_ledger (id_user, item_id, id DESC);

ALTER TABLE public.tb_mm_gear DROP CONSTRAINT IF EXISTS chk_mm_gear_qty;
ALTER TABLE public.tb_mm_gear ADD CONSTRAINT chk_mm_gear_qty CHECK (qty >= 0 AND qty <= 9999);

-- Refino por instância.
ALTER TABLE public.tb_mm_refine_proposal ADD COLUMN IF NOT EXISTS id_instance UUID NULL
  REFERENCES public.tb_mm_gear_instance(id_instance) ON DELETE CASCADE;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname FROM pg_constraint con
     WHERE con.conrelid = 'public.tb_mm_refine_proposal'::regclass AND con.contype = 'f'
       AND con.confrelid = 'public.tb_mm_gear'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.tb_mm_refine_proposal DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
DROP INDEX IF EXISTS public.ux_mm_refine_pending;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_refine_pending_item ON public.tb_mm_refine_proposal (id_user, item_id)
  WHERE status = 'pending' AND id_instance IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_refine_pending_instance ON public.tb_mm_refine_proposal (id_instance)
  WHERE status = 'pending' AND id_instance IS NOT NULL;
