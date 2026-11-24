-- 467 — Meu Mundo: refino das armas por BARRA DE XP (weapon-v2, 24/11/2026). Regra pura:
-- src/utils/mmItems/rules/weaponProgress.js.
--
--  • weapon_xp: XP da cópia DENTRO do nível atual (0 … xpNeed(nível) − 1). A barra dobra a cada 5 níveis.
--  • weapon_pending: a tentativa sorteada que espera a pessoa ACEITAR ou RECUSAR
--    ({ key, xp, tier, level, xpBefore, powder, at }). O pó já foi gasto quando ela nasce; recusar só descarta.
--    Enquanto houver uma, a cópia não refina de novo nem serve de doadora de estrela.
--  • Quem já tinha nível (weapon-v1) fica no mesmo nível com a barra vazia (DEFAULT 0): ninguém perde nada.
--  • Os pós SSS I/II/III viram SSR/Lendária/Divina 1:1 na primeira vez que a mochila abre (conversão
--    preguiçosa, catalog/retired.js), com linha no livro.
-- Idempotente.

ALTER TABLE public.tb_mm_gear_instance ADD COLUMN IF NOT EXISTS weapon_xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.tb_mm_gear_instance ADD COLUMN IF NOT EXISTS weapon_pending JSONB NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mm_instance_weapon_xp') THEN
    ALTER TABLE public.tb_mm_gear_instance ADD CONSTRAINT chk_mm_instance_weapon_xp CHECK (weapon_xp >= 0);
  END IF;
END $$;
