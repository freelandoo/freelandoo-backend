-- 448_meu_mundo_aprimoramento_garantido.sql — Meu Mundo 3D, trilha E, fatia E9 (decisão A2).
--
-- O refino sorteado (forge-v1: +0…+10, sobe/fica/desce com proposta) vira o APRIMORAMENTO GARANTIDO
-- (forge-v2: +0…+15, custo fixo, sempre sobe). Quem tinha +N passa a +round(1,5 × N); quem passou de
-- +10 nasce ascendido (o +11…+15 só vale com a Ascensão). As propostas abertas expiram (como já
-- expirariam em 15 min: a peça fica como estava). Idempotente: só pega o que ainda está em forge-v1.
-- A conta que ainda não materializou a pilha antiga converte no `prepare` do serviço (mesma conta).
-- tb_mm_refine_proposal não se apaga (histórico dos recibos).

UPDATE public.tb_mm_gear_instance
   SET plus = LEAST(15, ROUND(plus * 1.5)),
       ascended = ascended OR ROUND(plus * 1.5) > 10,
       rules = 'forge-v2',
       version = version + 1
 WHERE rules = 'forge-v1';

UPDATE public.tb_mm_refine_proposal
   SET status = 'expired', resolved_at = COALESCE(resolved_at, NOW())
 WHERE status = 'pending';

-- instância nova já nasce na regra nova (o materialize da pilha antiga grava 'forge-v1' explícito)
ALTER TABLE public.tb_mm_gear_instance ALTER COLUMN rules SET DEFAULT 'forge-v2';
