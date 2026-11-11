-- 439 — MEU MUNDO 3D, lore v2 etapa F1, FASE 2 (2026-11-10): os ids antigos saem do CHECK.
--
-- A 436 renomeou os tipos de monstro dos troféus (soldier -> cavaleiro, golem -> ciborgue,
-- harpy -> garras) e deixou o CHECK aceitando o velho E o novo, para uma instância com o código
-- anterior poder gravar durante a troca. O código de hoje só grava os ids novos
-- (meuMundoAdventure.js TROPHY_KINDS; o id antigo que um aparelho velho mandar é convertido na
-- entrada, MeuMundoAdventureService), então o CHECK fecha.
--
-- Antes de fechar, junta DE NOVO qualquer linha antiga gravada entre a 436 e esta (mesma regra
-- da 436), senão o ADD CONSTRAINT falharia e o boot cairia. Idempotente.

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

ALTER TABLE public.tb_mm_monster_trophy DROP CONSTRAINT IF EXISTS chk_mm_trophy_kind;
ALTER TABLE public.tb_mm_monster_trophy ADD CONSTRAINT chk_mm_trophy_kind
  CHECK (kind IN ('cavaleiro', 'stone', 'wolf', 'ciborgue', 'garras', 'brute'));
