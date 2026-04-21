-- 006_add_username.sql
-- Adiciona username único (case-insensitive) à tb_user.
-- Backfill: gera username a partir do email (parte antes do @), sanitiza e
-- resolve conflitos com sufixo numérico incremental.

-- 1. Adicionar coluna nullable primeiro (para backfill)
ALTER TABLE tb_user ADD COLUMN IF NOT EXISTS username VARCHAR(30);

-- 2. Backfill para usuários existentes
DO $$
DECLARE
  r RECORD;
  base TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR r IN SELECT id_user, email FROM tb_user WHERE username IS NULL LOOP
    -- Base: parte antes do @, lowercase, troca chars inválidos por _
    base := regexp_replace(lower(split_part(r.email, '@', 1)), '[^a-z0-9_.]', '_', 'g');
    -- Remove . ou _ no início
    base := regexp_replace(base, '^[._]+', '', 'g');
    -- Mínimo 3 chars: preenche com random se ficar muito curto
    IF length(base) < 3 THEN
      base := base || substring(md5(r.id_user::text), 1, 3);
    END IF;
    -- Máximo 27 chars (deixa espaço para sufixo)
    base := substring(base, 1, 27);

    candidate := base;
    suffix := 1;
    -- Resolve conflitos
    WHILE EXISTS (SELECT 1 FROM tb_user WHERE lower(username) = candidate) LOOP
      candidate := base || suffix::text;
      suffix := suffix + 1;
    END LOOP;

    UPDATE tb_user SET username = candidate WHERE id_user = r.id_user;
  END LOOP;
END $$;

-- 3. Tornar NOT NULL
ALTER TABLE tb_user ALTER COLUMN username SET NOT NULL;

-- 4. Índice único case-insensitive
CREATE UNIQUE INDEX IF NOT EXISTS idx_tb_user_username_lower
  ON tb_user (lower(username));

-- 5. Check constraint: formato válido
ALTER TABLE tb_user DROP CONSTRAINT IF EXISTS chk_tb_user_username_format;
ALTER TABLE tb_user ADD CONSTRAINT chk_tb_user_username_format
  CHECK (username ~ '^[a-z0-9][a-z0-9_.]{2,29}$');
