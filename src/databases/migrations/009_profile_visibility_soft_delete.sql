-- 009_profile_visibility_soft_delete.sql
-- Adiciona controle de visibilidade pública e soft delete em tb_profile.
-- is_visible: dono escolheu se quer aparecer publicamente (default TRUE).
-- deleted_at: marcador de soft delete (preserva histórico financeiro).

BEGIN;

ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS is_visible  BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_tb_profile_visible_alive
  ON public.tb_profile (id_user)
  WHERE deleted_at IS NULL AND is_visible = TRUE;

COMMIT;
