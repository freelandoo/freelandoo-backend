-- 462 — MEU MUNDO 3D: o roubo da Nívea (19/11, números aprovados pelo Alex).
--
-- Perder (ou fugir) de um monstro da rua ou de um Domínio tira 10% do néctar
-- que a conta carrega (`tb_mm_nectar_wallet.pending_ml`), entre 0,1 L e 2 L
-- (utils/meuMundoNectar.js `theftMl`). Tudo na transação do recibo da luta
-- (MeuMundoAdventureService.settleFight):
--   tb_mm_nectar_theft  o recibo do roubo: UM por luta (chave = id_fight), é
--                       também a linha do extrato ("roubado por um monstro")
--   tb_mm_nivea         o contador "Néctar da Nívea" (uma linha só)
-- Tudo em mililitros inteiros. Idempotente: só cria.

CREATE TABLE IF NOT EXISTS public.tb_mm_nectar_theft (
  id_fight UUID PRIMARY KEY,
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  kind TEXT NOT NULL,
  ml INTEGER NOT NULL,
  pending_before BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mm_nectar_theft_origin CHECK (origin IN ('mob', 'domain')),
  CONSTRAINT chk_mm_nectar_theft_ml CHECK (ml > 0)
);
CREATE INDEX IF NOT EXISTS idx_mm_nectar_theft_user ON public.tb_mm_nectar_theft (id_user, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tb_mm_nivea (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  total_ml BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mm_nivea_one CHECK (id = 1),
  CONSTRAINT chk_mm_nivea_total CHECK (total_ml >= 0)
);
INSERT INTO public.tb_mm_nivea (id, total_ml) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
