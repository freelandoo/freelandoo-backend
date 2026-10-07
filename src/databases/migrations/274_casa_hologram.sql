-- =============================================================================
-- Migration 274: hologramas colecionáveis da Casa Views (aba RA)
-- =============================================================================
-- Pedido do Alex (2026-10-07): uma aba "RA" na Casa Views. A câmera reconhece a
-- figura impressa, o personagem aparece em holograma rosa, a pessoa toca em
-- COLECIONAR, paga R$1,99 no Mercado Pago e, com o pagamento confirmado, o
-- holograma vira o personagem texturizado e entra na vitrine dela.
--
-- O catálogo (qual personagem existe e quanto custa) mora no código
-- (`CasaHologramService.CATALOG`): personagem novo chega junto do modelo 3D e
-- do alvo de rastreamento, que também são arquivos do front.
--
-- Cada linha é UMA compra. A vitrine lê as pagas e não estornadas.
--
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_casa_hologram_purchase (
  id                     BIGSERIAL PRIMARY KEY,
  id_user                UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  hologram_key           VARCHAR(40) NOT NULL,
  amount_cents           INTEGER NOT NULL DEFAULT 0,
  status                 VARCHAR(12) NOT NULL DEFAULT 'pending',
  stripe_session_id      VARCHAR(255) NULL,
  stripe_payment_intent  VARCHAR(255) NULL,
  paid_at                TIMESTAMPTZ NULL,
  refunded_at            TIMESTAMPTZ NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_casa_hologram_status CHECK (status IN ('pending', 'paid', 'expired', 'refunded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_casa_hologram_session
  ON public.tb_casa_hologram_purchase (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_casa_hologram_user_paid
  ON public.tb_casa_hologram_purchase (id_user, hologram_key)
  WHERE status = 'paid' AND refunded_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_casa_hologram_payment_intent
  ON public.tb_casa_hologram_purchase (stripe_payment_intent)
  WHERE stripe_payment_intent IS NOT NULL;
