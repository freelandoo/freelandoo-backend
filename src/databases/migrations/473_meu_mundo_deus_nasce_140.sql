-- 473 (25/11/2026): os DEUSES nascem com 1,40 m (regra do Alex; characters/rules.ts GROW.GOD_BIRTH).
-- A altura de agora já sai da conta nova (1,40 → altura de jovem), então nenhum deus encolhe;
-- aqui só a certidão dos deuses que já existem passa a dizer "altura ao nascer 1,40 m".
-- Idempotente: só toca quem ainda está abaixo de 1,40.
UPDATE public.tb_mm_character
   SET genetics = jsonb_set(genetics, '{birthHeight}', '1.4'::jsonb)
 WHERE species IN ('aurion', 'morkhan', 'kragor', 'zephyra', 'maru', 'iris', 'noctis', 'aeryn', 'varkos')
   AND genetics IS NOT NULL
   AND jsonb_typeof(genetics -> 'birthHeight') = 'number'
   AND (genetics ->> 'birthHeight')::numeric < 1.4;
