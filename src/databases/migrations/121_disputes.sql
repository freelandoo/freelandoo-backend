-- =============================================================================
-- Migration 121: Disputas + evidências (Proteção de Pagamento)
-- =============================================================================
-- Comprador/cliente abre disputa dentro da janela de 7d (ou a qualquer momento
-- para "não chegou"/"não apareceu", quando o caso ainda está awaiting_fulfillment).
-- Roteamento por reason_code (regras automáticas; admin só no limite).
--
-- reason_code:
--   product_not_arrived | product_wrong | product_defective
--   service_no_show     | scam          | other
-- state:
--   open → awaiting_return → return_in_transit → return_delivered
--        → resolved_refund | resolved_release | escalated_admin
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_dispute (
  id                   BIGSERIAL    PRIMARY KEY,
  protection_case_id   BIGINT       NOT NULL REFERENCES public.tb_protection_case(id) ON DELETE CASCADE,
  domain               VARCHAR(20)  NOT NULL CHECK (domain IN ('product','booking')),
  ref_id               BIGINT       NOT NULL,
  opened_by_user_id    UUID         REFERENCES public.tb_user(id_user),
  reason_code          VARCHAR(30)  NOT NULL CHECK (reason_code IN (
                         'product_not_arrived','product_wrong','product_defective',
                         'service_no_show','scam','other')),
  state                VARCHAR(30)  NOT NULL DEFAULT 'open' CHECK (state IN (
                         'open','awaiting_return','return_in_transit','return_delivered',
                         'resolved_refund','resolved_release','escalated_admin')),
  description          TEXT,
  resolved_by          VARCHAR(20)  CHECK (resolved_by IN ('system','admin')),
  resolution_note      TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dispute_state ON public.tb_dispute (state);
CREATE INDEX IF NOT EXISTS idx_dispute_case  ON public.tb_dispute (protection_case_id);
CREATE INDEX IF NOT EXISTS idx_dispute_ref   ON public.tb_dispute (domain, ref_id);

CREATE TABLE IF NOT EXISTS public.tb_dispute_evidence (
  id                   BIGSERIAL    PRIMARY KEY,
  dispute_id           BIGINT       NOT NULL REFERENCES public.tb_dispute(id) ON DELETE CASCADE,
  uploaded_by_user_id  UUID         REFERENCES public.tb_user(id_user),
  role                 VARCHAR(20)  NOT NULL CHECK (role IN ('buyer','seller','admin')),
  photo_url            TEXT,
  note                 TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute
  ON public.tb_dispute_evidence (dispute_id, created_at);
