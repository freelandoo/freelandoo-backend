-- Migration 004: Generic admin audit log
-- Used by non-affiliate admin flows (machines, categories, etc).
-- entity_id is TEXT so it can hold SERIAL ints (machines/categories) or UUIDs.

CREATE TABLE IF NOT EXISTS public.tb_admin_audit_log (
  id_log          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity          VARCHAR(40) NOT NULL,
  entity_id       TEXT,
  action          VARCHAR(40) NOT NULL,
  before_state    JSONB,
  after_state     JSONB,
  reason          TEXT,
  actor_user_id   UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_tb_admin_audit_entity
  ON public.tb_admin_audit_log (entity, entity_id, created_at DESC);
