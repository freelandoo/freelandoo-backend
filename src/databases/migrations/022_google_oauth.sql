-- Migration 022: Google OAuth 2.0 — vincula conta Google ao tb_user.
-- Idempotente.

ALTER TABLE public.tb_user
  ADD COLUMN IF NOT EXISTS google_sub VARCHAR(64);

-- Senha pode ficar nula para usuários que só logam via Google.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'tb_user'
       AND column_name  = 'senha'
       AND is_nullable  = 'NO'
  ) THEN
    EXECUTE 'ALTER TABLE public.tb_user ALTER COLUMN senha DROP NOT NULL';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ix_tb_user_google_sub
  ON public.tb_user (google_sub)
  WHERE google_sub IS NOT NULL;
