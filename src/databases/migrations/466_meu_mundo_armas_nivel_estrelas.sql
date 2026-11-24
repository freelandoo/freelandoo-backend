-- 466 — Meu Mundo: armas com NÍVEL 1–90 por refinamento com pó, ESTRELAS por cópia idêntica e forja por
-- fragmento de CLASSE (weapon-v1, 24/11/2026). Regra pura: src/utils/mmItems/rules/weaponProgress.js.
--
--  • weapon_level: nível da CÓPIA da arma (1 = nova). O teto de negócio (90) mora na regra; o banco
--    aceita até 999 para o teto poder subir sem migration nova.
--  • As estrelas usam a coluna `grade` (1…5) que já existe: 1 estrela = grau I … 5 = grau V (o progresso de
--    quem já tinha grau fica).
--  • legacy: retrato do que a cópia tinha antes da conversão ({ plus, grade, rules, conv }), recuperável.
--    A conversão é PREGUIÇOSA (MeuMundoGearStorage.convertWeapons, no `prepare`): só o servidor sabe
--    quais itens são armas, e pilha antiga que vira instância depois do deploy também passa por ela.
--  • As propostas do refino sorteado (forge-v1) já davam 410 desde a mig 448: as pendentes expiram aqui.
-- Idempotente.

ALTER TABLE public.tb_mm_gear_instance ADD COLUMN IF NOT EXISTS weapon_level SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE public.tb_mm_gear_instance ADD COLUMN IF NOT EXISTS legacy JSONB NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mm_instance_weapon_level') THEN
    ALTER TABLE public.tb_mm_gear_instance ADD CONSTRAINT chk_mm_instance_weapon_level CHECK (weapon_level BETWEEN 1 AND 999);
  END IF;
END $$;

UPDATE public.tb_mm_refine_proposal SET status = 'expired', resolved_at = NOW()
 WHERE status = 'pending';
