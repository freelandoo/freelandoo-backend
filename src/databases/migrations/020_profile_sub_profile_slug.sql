-- =============================================================================
-- Migration 020: sub_profile_slug em tb_profile (denormalização de profession_slug)
-- =============================================================================
-- Cacheia o profession_slug do tb_category diretamente em tb_profile, eliminando
-- a necessidade de JOIN para construir URLs canônicas e permitindo expor o slug
-- estavelmente mesmo se a categoria do perfil mudar.
--
-- Backfill copia tb_category.profession_slug. Para clans (id_category IS NULL),
-- usa "clan" como slug fixo. Constraint UNIQUE(id_user, id_category) WHERE
-- deleted_at IS NULL (migration 011) garante que não há colisão (handle, slug)
-- por usuário.
--
-- Idempotente.

-- 1. Coluna nullable inicialmente
ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS sub_profile_slug VARCHAR(80);

-- 2. Backfill: copia de tb_category, ou "clan" para perfis-clan
UPDATE public.tb_profile p
   SET sub_profile_slug = c.profession_slug
  FROM public.tb_category c
 WHERE p.id_category = c.id_category
   AND (p.sub_profile_slug IS NULL OR p.sub_profile_slug = '');

UPDATE public.tb_profile
   SET sub_profile_slug = 'clan'
 WHERE id_category IS NULL
   AND (sub_profile_slug IS NULL OR sub_profile_slug = '');

-- 3. NOT NULL após backfill
ALTER TABLE public.tb_profile
  ALTER COLUMN sub_profile_slug SET NOT NULL;

-- 4. Formato válido (mesmo regex de tb_category.profession_slug)
ALTER TABLE public.tb_profile
  DROP CONSTRAINT IF EXISTS chk_tb_profile_sub_profile_slug_format;
ALTER TABLE public.tb_profile
  ADD CONSTRAINT chk_tb_profile_sub_profile_slug_format
  CHECK (sub_profile_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(sub_profile_slug) BETWEEN 2 AND 80);

-- 5. Índice (handle, sub_profile_slug) — útil para resolver perfis públicos sem JOIN
CREATE INDEX IF NOT EXISTS idx_tb_profile_user_subslug_alive
  ON public.tb_profile (id_user, sub_profile_slug)
  WHERE deleted_at IS NULL;
