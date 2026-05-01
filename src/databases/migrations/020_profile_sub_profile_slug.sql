-- =============================================================================
-- Migration 020: sub_profile_slug em tb_profile (slug do sub-perfil = display_name)
-- =============================================================================
-- Cada sub-perfil de um usuário recebe um slug único derivado do display_name,
-- usado para desempatar URLs no formato /[profession]/[city]/[@handle]/[subProfile].
-- Múltiplos perfis por (id_user, id_category) são permitidos a partir desta mig.
--
-- Backfill: lower(unaccent(display_name)) → regex → fallback "perfil-N" se vazio.
-- Colisão por (id_user) é resolvida com sufixo "-2", "-3", ...
-- Para perfis-clan (id_category IS NULL) ou display_name vazio o fallback usa
-- "perfil-<id_profile>".
--
-- Idempotente — pode rodar múltiplas vezes.

-- 1. Coluna nullable inicialmente (se já existir de versão anterior, mantém)
ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS sub_profile_slug VARCHAR(80);

-- 2. Garante extensão unaccent (já criada por mig 011, mas defensivo)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 3. Drop constraint/index antigos pra reaplicar (versão anterior usava
--    profession_slug; agora migramos pra display_name).
ALTER TABLE public.tb_profile
  DROP CONSTRAINT IF EXISTS chk_tb_profile_sub_profile_slug_format;
DROP INDEX IF EXISTS idx_tb_profile_user_subslug_alive;

-- 4. Limpa qualquer valor antigo que veio de profession_slug pra forçar rebackfill.
--    Detectamos: linhas onde sub_profile_slug == profession_slug da categoria
--    (sinal de mig 020 antiga). Mantemos slugs já personalizados.
UPDATE public.tb_profile p
   SET sub_profile_slug = NULL
  FROM public.tb_category c
 WHERE p.id_category = c.id_category
   AND p.sub_profile_slug = c.profession_slug;

-- Clan profiles antigos com 'clan' também resetamos (vão receber perfil-<id>)
UPDATE public.tb_profile
   SET sub_profile_slug = NULL
 WHERE id_category IS NULL
   AND sub_profile_slug = 'clan';

-- 5. Backfill: gera slug a partir de display_name por usuário, com sufixo numérico
--    para resolver colisão dentro do mesmo id_user.
DO $bf$
DECLARE
  r RECORD;
  base TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR r IN
    SELECT id_profile, id_user, display_name
      FROM public.tb_profile
     WHERE deleted_at IS NULL
       AND (sub_profile_slug IS NULL OR sub_profile_slug = '')
     ORDER BY created_at ASC, id_profile ASC
  LOOP
    -- Slugify display_name
    base := lower(unaccent(COALESCE(r.display_name, '')));
    base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
    base := regexp_replace(base, '-+', '-', 'g');
    base := regexp_replace(base, '^-|-$', '', 'g');

    IF base IS NULL OR length(base) < 2 THEN
      base := 'perfil-' || r.id_profile::text;
    END IF;

    base := substring(base, 1, 75);

    candidate := base;
    suffix := 2;
    WHILE EXISTS (
      SELECT 1 FROM public.tb_profile
       WHERE id_user = r.id_user
         AND deleted_at IS NULL
         AND sub_profile_slug = candidate
         AND id_profile <> r.id_profile
    ) LOOP
      candidate := base || '-' || suffix::text;
      suffix := suffix + 1;
    END LOOP;

    UPDATE public.tb_profile
       SET sub_profile_slug = candidate,
           updated_at = NOW()
     WHERE id_profile = r.id_profile;
  END LOOP;

  -- Perfis soft-deleted que ainda não têm slug: usa fallback simples (não
  -- precisa ser único, pois constraint ignora deletados).
  UPDATE public.tb_profile
     SET sub_profile_slug = 'perfil-' || id_profile::text
   WHERE sub_profile_slug IS NULL OR sub_profile_slug = '';
END
$bf$;

-- 6. NOT NULL após backfill
ALTER TABLE public.tb_profile
  ALTER COLUMN sub_profile_slug SET NOT NULL;

-- 7. Formato válido
ALTER TABLE public.tb_profile
  ADD CONSTRAINT chk_tb_profile_sub_profile_slug_format
  CHECK (sub_profile_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(sub_profile_slug) BETWEEN 2 AND 80);

-- 8. Índice único (id_user, sub_profile_slug) para perfis vivos —
--    garante que (handle, sub_profile_slug) resolva 1 perfil único.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tb_profile_user_subslug_alive
  ON public.tb_profile (id_user, sub_profile_slug)
  WHERE deleted_at IS NULL;
