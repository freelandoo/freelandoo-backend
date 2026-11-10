-- 436 — MEU MUNDO 3D, lore v2 etapa F1 (2026-11-10): IDS DOS MONSTROS.
--
-- Decisão do Alex (MEU MUNDO 3D/historia/v2/00-classificacao.md e planos/2026-11-09-roteiro-lore-v2.md):
-- o Soldado de Pedra É o Cavaleiro Dourado, e o Golem de Pedra é outro ser. Os tipos da luta
-- mudam de nome para dizer o que são:
--   soldier -> cavaleiro   (Soldado de Pedra / Cavaleiro Dourado)
--   golem   -> ciborgue    (o "golem" da regra sempre apareceu na tela como Ciborgue)
--   harpy   -> garras      (Dama das Garras)
--   stone   =  Golem de Pedra (já existia nos troféus; agora também é tipo da luta)
-- A regra está em features/meu-mundo/laminas/sim/fight.ts (cópia gerada: src/utils/meuMundoFight.js).
--
-- Aqui: os troféus (tb_mm_monster_trophy, mig 365). Recibos e eventos antigos ficam como foram
-- gravados (são histórico); quem lê converte por LEGACY_MOB_KIND.
--
-- CHECK em duas fases: esta migration aceita os ids antigos E os novos (uma instância ainda com o
-- código anterior pode gravar durante a troca); os antigos saem do CHECK numa migration futura.
-- Idempotente: pode rodar de novo sem mudar nada.

ALTER TABLE public.tb_mm_monster_trophy DROP CONSTRAINT IF EXISTS chk_mm_trophy_kind;
ALTER TABLE public.tb_mm_monster_trophy ADD CONSTRAINT chk_mm_trophy_kind
  CHECK (kind IN ('soldier', 'stone', 'wolf', 'golem', 'harpy', 'brute', 'cavaleiro', 'ciborgue', 'garras'));

-- Junta a linha antiga na nova (se as duas existirem, soma) e apaga a antiga.
INSERT INTO public.tb_mm_monster_trophy (id_user, kind, wins, losses, best_level, first_win_at, last_at)
SELECT t.id_user,
       CASE t.kind WHEN 'soldier' THEN 'cavaleiro' WHEN 'golem' THEN 'ciborgue' ELSE 'garras' END,
       t.wins, t.losses, t.best_level, t.first_win_at, t.last_at
  FROM public.tb_mm_monster_trophy t
 WHERE t.kind IN ('soldier', 'golem', 'harpy')
ON CONFLICT (id_user, kind) DO UPDATE SET
  wins = public.tb_mm_monster_trophy.wins + EXCLUDED.wins,
  losses = public.tb_mm_monster_trophy.losses + EXCLUDED.losses,
  best_level = GREATEST(public.tb_mm_monster_trophy.best_level, EXCLUDED.best_level),
  first_win_at = LEAST(public.tb_mm_monster_trophy.first_win_at, EXCLUDED.first_win_at),
  last_at = GREATEST(public.tb_mm_monster_trophy.last_at, EXCLUDED.last_at);

DELETE FROM public.tb_mm_monster_trophy WHERE kind IN ('soldier', 'golem', 'harpy');
