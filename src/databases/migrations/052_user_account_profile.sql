-- =============================================================================
-- Migration 052: Perfil-fantasma do user account (portfólio pessoal)
-- =============================================================================
-- Cada usuário ganha um perfil "system" para postar no portfólio pessoal sem
-- precisar de subperfil profissional. Esse perfil:
--   - aparece no FEED (feed_visible = TRUE)
--   - NÃO aparece na VITRINE (showcase_visible = FALSE)
--   - NÃO aparece nos RANKINGS (ranking_visible = FALSE)
--   - NÃO é clan (is_clan = FALSE)
--   - NÃO é vendável (is_paid = FALSE, is_visible = FALSE)
--
-- Reaproveita as tabelas e endpoints existentes de portfólio.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Novas colunas em tb_profile
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS is_user_account   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS feed_visible      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS showcase_visible  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ranking_visible   BOOLEAN NOT NULL DEFAULT TRUE;

-- Garante: no máximo 1 perfil-fantasma por usuário
CREATE UNIQUE INDEX IF NOT EXISTS uq_tb_profile_user_account
  ON public.tb_profile (id_user)
  WHERE is_user_account = TRUE;

-- Índice auxiliar para filtros de feed / vitrine / ranking
CREATE INDEX IF NOT EXISTS idx_tb_profile_visibility_flags
  ON public.tb_profile (showcase_visible, ranking_visible, feed_visible)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Backfill: cria 1 perfil-fantasma por usuário existente sem um
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.tb_profile (
  id_user,
  id_category,
  display_name,
  is_active,
  is_visible,
  is_user_account,
  feed_visible,
  showcase_visible,
  ranking_visible
)
SELECT
  u.id_user,
  COALESCE((SELECT id_category FROM public.tb_category ORDER BY id_category LIMIT 1), 1),
  u.nome,
  TRUE,
  FALSE,
  TRUE,
  TRUE,
  FALSE,
  FALSE
FROM public.tb_user u
WHERE NOT EXISTS (
  SELECT 1 FROM public.tb_profile p
   WHERE p.id_user = u.id_user AND p.is_user_account = TRUE
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Garantia adicional: perfis-fantasma sempre nascem com flags certas
--   (defensivo — application code também garante; este trigger é fallback)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_user_account_profile_defaults()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_user_account = TRUE THEN
    NEW.showcase_visible := FALSE;
    NEW.ranking_visible  := FALSE;
    NEW.feed_visible     := TRUE;
    NEW.is_visible       := FALSE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_account_profile_defaults ON public.tb_profile;
CREATE TRIGGER trg_user_account_profile_defaults
  BEFORE INSERT OR UPDATE OF is_user_account, showcase_visible, ranking_visible, feed_visible
  ON public.tb_profile
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_user_account_profile_defaults();

COMMIT;
