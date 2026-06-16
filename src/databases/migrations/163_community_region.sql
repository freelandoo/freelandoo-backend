-- =============================================================================
-- Migration 163: Região das comunidades (filtro por região no ranking + vitrine)
-- Comunidade nasce sem região (criada só com id_machine). Aqui ela HERDA a região
-- do líder: o subperfil de maior XP do líder que tenha id_region. A criação passa
-- a setar isso em CommunityStorage.createCommunity; esta migration faz o backfill
-- das comunidades já existentes. Idempotente (só preenche id_region ainda nulo).
-- =============================================================================

UPDATE public.tb_profile c
   SET id_region = sub.id_region,
       estado    = COALESCE(c.estado, sub.estado),
       municipio = COALESCE(c.municipio, sub.municipio)
  FROM (
    SELECT DISTINCT ON (cc.id_profile)
           cc.id_profile AS community_id,
           p.id_region, p.estado, p.municipio
      FROM public.tb_profile cc
      JOIN public.tb_profile p
        ON p.id_user = cc.id_leader_user
       AND p.is_clan = FALSE
       AND p.is_community = FALSE
       AND p.deleted_at IS NULL
       AND p.id_region IS NOT NULL
     WHERE cc.is_community = TRUE
       AND cc.deleted_at IS NULL
     ORDER BY cc.id_profile, p.xp_total DESC
  ) sub
 WHERE c.id_profile = sub.community_id
   AND c.is_community = TRUE
   AND c.id_region IS NULL;

-- Índice de apoio ao filtro por região das comunidades (vitrine + ranking).
CREATE INDEX IF NOT EXISTS idx_tb_profile_community_region
  ON public.tb_profile (id_region)
  WHERE is_community = TRUE AND deleted_at IS NULL;
