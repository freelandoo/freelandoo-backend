ALTER TABLE public.tb_profile_portfolio_media
  ADD COLUMN IF NOT EXISTS original_filename TEXT,
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS width INTEGER,
  ADD COLUMN IF NOT EXISTS height INTEGER,
  ADD COLUMN IF NOT EXISTS size_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC,
  ADD COLUMN IF NOT EXISTS storage_key TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF to_regclass('public.tb_user_media') IS NOT NULL THEN
    ALTER TABLE public.tb_user_media
      ADD COLUMN IF NOT EXISTS original_filename TEXT,
      ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100),
      ADD COLUMN IF NOT EXISTS width INTEGER,
      ADD COLUMN IF NOT EXISTS height INTEGER,
      ADD COLUMN IF NOT EXISTS size_bytes INTEGER,
      ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC,
      ADD COLUMN IF NOT EXISTS storage_key TEXT,
      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;
