-- =============================================================================
-- Migration 011: SEO — profession_slug em tb_category + UNIQUE(id_user, id_category)
-- =============================================================================
-- Adiciona slug canônico de profissão para URLs SEO (/[profession]/[city]/[handle])
-- e garante que cada usuário tenha no máximo 1 perfil por categoria (necessário
-- para que (handle, profession_slug) identifique unicamente um perfil).
--
-- Idempotente: pode rodar múltiplas vezes.

-- 1. Extensão para remover acentos no slugify
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2. Coluna profession_slug
ALTER TABLE public.tb_category
  ADD COLUMN IF NOT EXISTS profession_slug VARCHAR(80);

-- 3. Backfill: gerar slug a partir de desc_category, resolvendo conflitos
DO $$
DECLARE
  r RECORD;
  base TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR r IN
    SELECT id_category, desc_category
      FROM public.tb_category
     WHERE profession_slug IS NULL OR profession_slug = ''
     ORDER BY id_category
  LOOP
    -- Slugify: unaccent → lower → não-alfanum vira hífen → colapsa hífens → trim
    base := lower(unaccent(r.desc_category));
    base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
    base := regexp_replace(base, '-+', '-', 'g');
    base := regexp_replace(base, '^-|-$', '', 'g');

    IF base IS NULL OR length(base) = 0 THEN
      base := 'categoria-' || r.id_category::text;
    END IF;

    -- Limita a 75 chars (deixa folga para sufixo "-NNN")
    base := substring(base, 1, 75);

    candidate := base;
    suffix := 2;
    WHILE EXISTS (
      SELECT 1 FROM public.tb_category
       WHERE lower(profession_slug) = candidate
         AND id_category <> r.id_category
    ) LOOP
      candidate := base || '-' || suffix::text;
      suffix := suffix + 1;
    END LOOP;

    UPDATE public.tb_category
       SET profession_slug = candidate,
           updated_at = NOW()
     WHERE id_category = r.id_category;
  END LOOP;
END $$;

-- 4. NOT NULL e formato válido
ALTER TABLE public.tb_category
  ALTER COLUMN profession_slug SET NOT NULL;

ALTER TABLE public.tb_category
  DROP CONSTRAINT IF EXISTS chk_tb_category_profession_slug_format;
ALTER TABLE public.tb_category
  ADD CONSTRAINT chk_tb_category_profession_slug_format
  CHECK (profession_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(profession_slug) BETWEEN 2 AND 80);

-- 5. Índice único case-insensitive
CREATE UNIQUE INDEX IF NOT EXISTS idx_tb_category_profession_slug_lower
  ON public.tb_category (lower(profession_slug));

-- =============================================================================
-- 6. (Histórico) UNIQUE (id_user, id_category) — REMOVIDO em mig 021
-- =============================================================================
-- Originalmente esta mig criava um índice único (id_user, id_category) WHERE
-- deleted_at IS NULL para garantir que (handle, profession_slug) identificasse
-- 1 único perfil. A partir do redesign de sub-perfis (mig 021), múltiplos
-- perfis por categoria são permitidos e desempatados via sub_profile_slug.
-- Mantemos esta mig sem operação no bloco 6 para evitar abort idempotente.
DROP INDEX IF EXISTS idx_tb_profile_user_category_active;
