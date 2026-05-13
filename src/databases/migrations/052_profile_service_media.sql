-- =============================================================================
-- Migration 052: Profile Service Media — mídias vinculadas a serviços
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_profile_service_media (
  id_service_media    BIGSERIAL       PRIMARY KEY,
  id_profile_service  BIGINT          NOT NULL REFERENCES public.tb_profile_service(id_profile_service) ON DELETE CASCADE,
  id_profile          UUID            NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  media_url           TEXT            NOT NULL,
  media_type          VARCHAR(20)     NOT NULL CHECK (media_type IN ('image','video')),
  thumbnail_url       TEXT,
  storage_key         TEXT,
  thumbnail_key       TEXT,
  original_filename   TEXT,
  mime_type           VARCHAR(100),
  width              INTEGER,
  height             INTEGER,
  size_bytes         INTEGER,
  duration_seconds   NUMERIC,
  sort_order         INTEGER         NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_media_service
  ON public.tb_profile_service_media (id_profile_service);

CREATE INDEX IF NOT EXISTS idx_service_media_profile
  ON public.tb_profile_service_media (id_profile);
