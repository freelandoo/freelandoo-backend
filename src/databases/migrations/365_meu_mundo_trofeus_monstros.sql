-- 365 — MEU MUNDO 3D B5 (2026-11-08): INVENTÁRIO DE MONSTROS do jogador.
--
-- Decisão (docs/prompts/FILA.md, B5): a loja unificada ganha a aba Monstros com o que o
-- jogador tem da Arena das Lâminas e da rua. Não existia tabela: os resultados só ficavam
-- espalhados nos recibos (tb_mm_receipt, source 'fight'). Uma linha por jogador e monstro,
-- gravada no fechamento da luta conferida (MeuMundoAdventureService.settleFight), na mesma
-- transação do recibo. Conta luta de verdade: Arena (origin 'laminas') e rua ('mob');
-- ringue do Boxe (adversários humanos) e o treino do prólogo ficam de fora, e abandono
-- não conta. Na rua, o 'soldier' é o Golem de Pedra: kind 'stone' (como MOB_SHEETS).
--
-- Idempotente: CREATE IF NOT EXISTS + carga a partir dos recibos só quando a tabela está vazia.

CREATE TABLE IF NOT EXISTS public.tb_mm_monster_trophy (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  best_level INTEGER NOT NULL DEFAULT 0,
  first_win_at TIMESTAMPTZ NULL,
  last_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, kind),
  CONSTRAINT chk_mm_trophy_kind CHECK (kind IN ('soldier', 'stone', 'wolf', 'golem', 'harpy', 'brute')),
  CONSTRAINT chk_mm_trophy_counts CHECK (wins >= 0 AND losses >= 0 AND best_level >= 0)
);

-- Carga inicial pelos recibos de luta já gravados (só se ainda não houver linha nenhuma).
INSERT INTO public.tb_mm_monster_trophy (id_user, kind, wins, losses, best_level, first_win_at, last_at)
SELECT r.id_user,
       CASE WHEN r.result->>'origin' = 'mob' AND r.result->>'kind' = 'soldier' THEN 'stone' ELSE r.result->>'kind' END AS kind,
       COUNT(*) FILTER (WHERE (r.result->>'win')::boolean),
       COUNT(*) FILTER (WHERE NOT (r.result->>'win')::boolean),
       COALESCE(MAX(CASE WHEN (r.result->>'win')::boolean AND (r.result->>'level') ~ '^[0-9]+$' THEN (r.result->>'level')::int END), 0),
       MIN(r.created_at) FILTER (WHERE (r.result->>'win')::boolean),
       MAX(r.created_at)
  FROM public.tb_mm_receipt r
 WHERE r.source = 'fight'
   AND r.result->>'origin' IN ('laminas', 'mob')
   AND r.result->>'kind' IN ('soldier', 'wolf', 'golem', 'harpy', 'brute')
   AND COALESCE((r.result->>'abandoned')::boolean, false) = false
   AND NOT EXISTS (SELECT 1 FROM public.tb_mm_monster_trophy)
 GROUP BY 1, 2
ON CONFLICT (id_user, kind) DO NOTHING;
