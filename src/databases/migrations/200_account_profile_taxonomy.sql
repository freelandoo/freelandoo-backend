-- =============================================================================
-- Migration 200: perfil-conta pode DECLARAR enxame/profissão (e cidade)
-- =============================================================================
-- Contexto: o perfil-conta (is_user_account=TRUE, criado por
-- AuthStorage.ensureUserAccountProfile) nasce com uma categoria "fantasma" — a
-- primeira linha de tb_category — só para satisfazer o CHECK
-- chk_profile_clan_taxonomy da mig 016 (não-clan exige id_category NOT NULL).
-- Por isso vitrine (SearchStorage) e ranking (RankingStorage) mascaram a
-- taxonomia da conta com CASE→NULL e a excluem dos escopos taxonômicos.
--
-- A partir do onboarding em 2 passos (2026-08-08), o usuário ESCOLHE enxame,
-- profissão e cidade no primeiro login. Precisamos distinguir "categoria
-- fantasma" de "categoria declarada pelo dono" — é o que esta coluna faz:
--
--   taxonomy_declared_at IS NULL     → fantasma (não expor, não ranquear)
--   taxonomy_declared_at IS NOT NULL → declarada (vale como qualquer subperfil)
--
-- SEM backfill de propósito: toda checagem é guardada por is_user_account
-- (subperfil/clan sempre teve taxonomia real, a coluna é irrelevante para eles),
-- e marcar os perfis-conta existentes seria declarar a fantasma como verdade.
-- Idempotente.
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS taxonomy_declared_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.tb_profile.taxonomy_declared_at IS
  'Perfil-conta: quando o dono declarou enxame/profissão no onboarding. NULL = categoria fantasma (AuthStorage.ensureUserAccountProfile). Irrelevante para subperfis/clans.';

-- Vitrine e ranking por escopo passam a incluir o perfil-conta declarado; o
-- índice parcial cobre exatamente esse recorte.
CREATE INDEX IF NOT EXISTS idx_tb_profile_account_taxonomy
  ON public.tb_profile (id_category)
  WHERE is_user_account = TRUE
    AND taxonomy_declared_at IS NOT NULL
    AND deleted_at IS NULL;

COMMIT;
