-- 420: VIDA DO BEE PELO EMBALO (regra do Alex, 2026-11-08).
-- Antes: 24 h + 1 h por ponto de engajamento, teto de 7 dias. Agora não há teto:
-- o bee fica no ar enquanto CONTINUA crescendo e só some quando o crescimento
-- cai muito. Regra em src/utils/beeLife.js (fonte única; BEE_ALIVE_SQL vem de lá).
--   momentum      = soma dos pontos de alcance recentes, que perde metade a cada 12 h
--   momentum_at   = quando o momentum foi gravado (o valor "agora" é decaído na leitura)
--   momentum_peak = o maior momentum que o bee já teve
-- Idempotente.
ALTER TABLE public.tb_story
  ADD COLUMN IF NOT EXISTS momentum      NUMERIC     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS momentum_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS momentum_peak NUMERIC     NOT NULL DEFAULT 0;

-- Quem está no ar pela regra antiga entra com o embalo = pontos de alcance que já
-- tem (o resto fica com 0 e segue fora, como já estava). Só uma vez: momentum_at nulo.
UPDATE public.tb_story s
   SET momentum = s.reach_points,
       momentum_peak = s.reach_points,
       momentum_at = NOW()
 WHERE s.kind = 'bee'
   AND s.momentum_at IS NULL
   AND s.deleted_at IS NULL
   AND NOW() < LEAST(
         s.created_at + INTERVAL '7 days',
         s.created_at + INTERVAL '24 hours' + (s.engagement_score * INTERVAL '1 hour')
       );
