-- =============================================================================
-- Migration 071: Product Request Responses + notification type expansion
-- =============================================================================
-- Respostas dos vendedores aos Pedidos de Produto. Vendedor pode sugerir
-- um produto da própria loja (id_profile_product) ou enviar proposta livre.
-- UNIQUE (id_product_request, id_profile) — 1 resposta por subperfil por pedido.
-- Também amplia o CHECK de tb_notification.type para incluir notificações de
-- pedido de produto (mural) e nova resposta ao pedido (comprador).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_product_request_response (
  id_response             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_product_request      UUID         NOT NULL REFERENCES public.tb_product_request(id_product_request) ON DELETE CASCADE,
  id_seller_user          UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_profile              UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_profile_product      BIGINT       REFERENCES public.tb_profile_product(id_profile_product) ON DELETE SET NULL,
  message                 TEXT         NOT NULL,
  proposed_price_cents    INT          CHECK (proposed_price_cents IS NULL OR proposed_price_cents >= 0),
  status                  VARCHAR(16)  NOT NULL DEFAULT 'sent'
                            CHECK (status IN ('sent','accepted','rejected','negotiating','canceled')),
  buyer_last_read_at      TIMESTAMPTZ,
  seller_last_read_at     TIMESTAMPTZ,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (id_product_request, id_profile)
);

CREATE INDEX IF NOT EXISTS idx_prr_request
  ON public.tb_product_request_response (id_product_request, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prr_seller_profile
  ON public.tb_product_request_response (id_profile, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prr_seller_user
  ON public.tb_product_request_response (id_seller_user, created_at DESC);

-- ─── Expande CHECK de tipos de notificação ──────────────────────────────────
ALTER TABLE public.tb_notification
  DROP CONSTRAINT IF EXISTS tb_notification_type_chk;
ALTER TABLE public.tb_notification
  ADD CONSTRAINT tb_notification_type_chk
  CHECK (type IN (
    'like_received',
    'comment_received',
    'follow_received',
    'message_received',
    'product_request_new',
    'product_response_new'
  ));
