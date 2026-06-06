-- =============================================================================
-- Migration 124: 1 clan por USUÁRIO (não por subperfil)
-- =============================================================================
-- tb_clan_member referencia o subperfil (id_member_profile); pra garantir que um
-- usuário inteiro participe de no máximo UM clan, denormalizamos id_user e
-- impomos UNIQUE(id_user). Idempotente: ADD COLUMN IF NOT EXISTS + backfill +
-- índice único. O owner também é uma row de membro, então conta como a (única)
-- membresia daquele usuário.
-- =============================================================================

ALTER TABLE public.tb_clan_member
  ADD COLUMN IF NOT EXISTS id_user UUID REFERENCES public.tb_user(id_user) ON DELETE CASCADE;

-- Backfill a partir do dono do subperfil membro
UPDATE public.tb_clan_member cm
   SET id_user = p.id_user
  FROM public.tb_profile p
 WHERE p.id_profile = cm.id_member_profile
   AND cm.id_user IS DISTINCT FROM p.id_user;

-- Limpeza: membresias de clans já deletados são lixo e não devem disputar o
-- UNIQUE(id_user) (ex.: usuário de teste dono de 2 clans deletados). Sem isso o
-- índice único falharia. Clans ativos não são tocados.
DELETE FROM public.tb_clan_member cm
USING public.tb_profile clan
WHERE clan.id_profile = cm.id_clan_profile
  AND clan.deleted_at IS NOT NULL;

ALTER TABLE public.tb_clan_member
  ALTER COLUMN id_user SET NOT NULL;

-- UNIQUE: um usuário aparece em no máximo uma linha de membro (= um clan)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clan_member_user_unique
  ON public.tb_clan_member (id_user);
