-- 323 — Refino pago com proposta persistente e aceite explícito (mm3d-61).
-- Equipamento pertence à conta e atravessa gerações. Não altera XP, idade,
-- atributos, picos ou níveis já conquistados. Nunca editar a migration 321.

ALTER TABLE public.tb_mm_gear ADD COLUMN IF NOT EXISTS refine_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.tb_mm_gear ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.tb_mm_gear DROP CONSTRAINT IF EXISTS chk_mm_gear_level;
ALTER TABLE public.tb_mm_gear ADD CONSTRAINT chk_mm_gear_level CHECK (level >= 0 AND level <= 10);
ALTER TABLE public.tb_mm_gear DROP CONSTRAINT IF EXISTS chk_mm_gear_refine_failures;
ALTER TABLE public.tb_mm_gear ADD CONSTRAINT chk_mm_gear_refine_failures CHECK (refine_failures BETWEEN 0 AND 3);
ALTER TABLE public.tb_mm_gear DROP CONSTRAINT IF EXISTS chk_mm_gear_version;
ALTER TABLE public.tb_mm_gear ADD CONSTRAINT chk_mm_gear_version CHECK (version >= 0);

CREATE TABLE IF NOT EXISTS public.tb_mm_refine_proposal (
  id_proposal UUID PRIMARY KEY,
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  create_key UUID NOT NULL,
  request_hash TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  item_version BIGINT NOT NULL,
  from_level INTEGER NOT NULL CHECK (from_level BETWEEN 0 AND 9),
  candidate_level INTEGER NOT NULL CHECK (candidate_level BETWEEN 0 AND 10),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'discarded', 'expired')),
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolve_key UUID,
  create_receipt UUID REFERENCES public.tb_mm_receipt(id_receipt) ON DELETE SET NULL,
  resolve_receipt UUID REFERENCES public.tb_mm_receipt(id_receipt) ON DELETE SET NULL,
  UNIQUE (id_user, create_key),
  FOREIGN KEY (id_user, item_id) REFERENCES public.tb_mm_gear(id_user, item_id) ON DELETE CASCADE,
  CONSTRAINT chk_mm_refine_expiry CHECK (expires_at > created_at),
  CONSTRAINT chk_mm_refine_candidate CHECK (candidate_level >= GREATEST(0, from_level - 1) AND candidate_level <= from_level + 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_refine_pending ON public.tb_mm_refine_proposal(id_user, item_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_refine_resolve_key ON public.tb_mm_refine_proposal(id_user, resolve_key) WHERE resolve_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mm_refine_account ON public.tb_mm_refine_proposal(id_user, created_at DESC);

-- Receitas aprendidas, aparência de arma ativa e leitura de itens de missão.
-- A leitura NÃO conclui uma missão, e cosméticos NÃO concedem atributos.
CREATE TABLE IF NOT EXISTS public.tb_mm_gear_unlock (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('recipe', 'cosmetic', 'quest', 'emote')),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, item_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_weapon_cosmetic_active ON public.tb_mm_gear_unlock(id_user) WHERE kind = 'cosmetic' AND active;
