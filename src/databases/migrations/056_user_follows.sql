-- =============================================================================
-- Migration 056: User-level follows
-- =============================================================================
-- Refatora o conceito de "acompanhar": antes era subperfil→subperfil/clan
-- (tb entity_follows). Agora a relação fica ligada ao USER dono do follower,
-- não ao subperfil que clicou. Motivação: a faixa de stories (Slice 2) precisa
-- saber "quem o user está acompanhando", e ele pode acompanhar pelo subperfil
-- A ou B — ambos colapsam em um único follow no nível do user.
--
-- Regras:
--   • follower = user (tb_user.id_user)
--   • target   = subperfil ou clan (tb_profile.id_profile)
--   • User não pode ser alvo de follow — apenas subperfis/clans.
--   • Soft delete (deleted_at) com unique parcial sobre registros ativos.
--
-- Backfill: colapsa registros ativos de entity_follows resolvendo o owner
-- do follower (subperfil → id_user; clan → id_user do owner). Duplicatas
-- (mesmo user seguindo o mesmo target por 2 subperfis seus) viram um único
-- registro com o created_at mais antigo.
--
-- tb entity_follows continua existindo para compatibilidade — write-through
-- no EntityFollowService alimenta tb_user_follow.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_user_follow (
  id_follow         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_user_id  UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  target_profile_id UUID NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_follow_active
  ON public.tb_user_follow (follower_user_id, target_profile_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_user_follow_follower
  ON public.tb_user_follow (follower_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_user_follow_target
  ON public.tb_user_follow (target_profile_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ─── Backfill a partir de entity_follows ──────────────────────────────────────
-- Resolve owner do follower:
--   • follower_type='profile' → tb_profile.id_user diretamente
--   • follower_type='clan'    → id_user do membro com role='owner'
WITH resolved AS (
  SELECT
    CASE
      WHEN ef.follower_type = 'profile' THEN owner_p.id_user
      WHEN ef.follower_type = 'clan'    THEN clan_owner_user.id_user
    END                              AS follower_user_id,
    ef.target_id                      AS target_profile_id,
    MIN(ef.created_at)                AS created_at
  FROM public.entity_follows ef
  LEFT JOIN public.tb_profile owner_p
    ON owner_p.id_profile = ef.follower_id
   AND ef.follower_type = 'profile'
  LEFT JOIN public.tb_clan_member cm_owner
    ON cm_owner.id_clan_profile = ef.follower_id
   AND cm_owner.role = 'owner'
   AND ef.follower_type = 'clan'
  LEFT JOIN public.tb_profile clan_owner_member
    ON clan_owner_member.id_profile = cm_owner.id_member_profile
  LEFT JOIN public.tb_user clan_owner_user
    ON clan_owner_user.id_user = clan_owner_member.id_user
  WHERE ef.deleted_at IS NULL
  GROUP BY
    CASE
      WHEN ef.follower_type = 'profile' THEN owner_p.id_user
      WHEN ef.follower_type = 'clan'    THEN clan_owner_user.id_user
    END,
    ef.target_id
)
INSERT INTO public.tb_user_follow (follower_user_id, target_profile_id, created_at)
SELECT r.follower_user_id, r.target_profile_id, r.created_at
  FROM resolved r
 WHERE r.follower_user_id IS NOT NULL
   AND r.target_profile_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM public.tb_user_follow uf
      WHERE uf.follower_user_id  = r.follower_user_id
        AND uf.target_profile_id = r.target_profile_id
        AND uf.deleted_at IS NULL
   );

COMMIT;
