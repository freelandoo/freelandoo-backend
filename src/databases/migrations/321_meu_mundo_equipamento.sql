-- 321 — MEU MUNDO 3D mm3d-59 (reforma, slice 3): EQUIPAMENTO, materiais e forja.
--
-- Catálogo em src/utils/meuMundoGear.js (o banco guarda só posse e o que está
-- equipado). Os 30 consumíveis, a geladeira (tb_mm_pantry), as skins e os
-- veículos NÃO mudam. Posse é da PESSOA (atravessa gerações, como moedas).
-- `level` = aprimoramento da forja (0–5) para arma/proteção.
-- Compras, forja e reciclagem passam por um recibo (tb_mm_receipt, mig 320)
-- com a chave do pedido — clique repetido/duas abas não cobram duas vezes.

CREATE TABLE IF NOT EXISTS public.tb_mm_gear (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 0,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, item_id),
  CONSTRAINT chk_mm_gear_qty CHECK (qty >= 0 AND qty <= 999),
  CONSTRAINT chk_mm_gear_level CHECK (level >= 0 AND level <= 5)
);

CREATE TABLE IF NOT EXISTS public.tb_mm_equip (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  item_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, slot),
  CONSTRAINT chk_mm_equip_slot CHECK (slot IN ('weapon', 'armor', 'acc1', 'acc2'))
);
