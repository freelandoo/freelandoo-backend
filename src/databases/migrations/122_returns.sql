-- =============================================================================
-- Migration 122: Logística reversa (devolução) — Proteção de Pagamento
-- =============================================================================
-- 1 devolução por disputa (apenas produtos com motivo errado/defeituoso). A
-- etiqueta reversa é comprada no Melhor Envio (Correios), gerando um código de
-- autorização de postagem. O reembolso dispara quando o rastreio reverso marca
-- ENTREGUE na origem (delivered_origin).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_return (
  id                     BIGSERIAL    PRIMARY KEY,
  dispute_id             BIGINT       NOT NULL UNIQUE REFERENCES public.tb_dispute(id) ON DELETE CASCADE,
  me_reverse_order_id    VARCHAR(120),
  reverse_tracking_code  VARCHAR(120),
  reverse_auth_code      VARCHAR(200),
  reverse_label_url      TEXT,
  reverse_status         VARCHAR(30)  NOT NULL DEFAULT 'pending' CHECK (reverse_status IN (
                           'pending','code_issued','posted','in_transit','delivered_origin','expired','error')),
  purchased_at           TIMESTAMPTZ,
  posted_at              TIMESTAMPTZ,
  delivered_at           TIMESTAMPTZ,
  error                  TEXT,
  attempts               INT          NOT NULL DEFAULT 0,
  last_attempt_at        TIMESTAMPTZ,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_return_status ON public.tb_return (reverse_status);

-- Retry da compra: pendentes/erro com < 5 tentativas e gap de 30 min.
CREATE INDEX IF NOT EXISTS idx_return_pending_purchase
  ON public.tb_return (last_attempt_at)
  WHERE reverse_status IN ('pending','error') AND attempts < 5;
