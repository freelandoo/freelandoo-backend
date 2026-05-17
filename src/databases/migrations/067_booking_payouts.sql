-- =============================================================================
-- Migration 067: Booking Payouts (saldo dos profissionais por agendamento pago)
-- =============================================================================
-- Espelha tb_seller_balance da Loja (mig 064). Cada booking que ficou pago
-- (status='confirmed', payment_status='paid') vira um registro de saldo do
-- profissional com holdback de 8 dias. Plataforma paga manual via PIX/banco.
-- Bookings já pagos no histórico recebem backfill abaixo.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_booking_payout (
  id_payout              BIGSERIAL    PRIMARY KEY,
  id_booking             BIGINT       NOT NULL UNIQUE REFERENCES public.tb_profile_bookings(id) ON DELETE CASCADE,
  id_profile             UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE RESTRICT,
  id_owner_user          UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE RESTRICT,
  id_profile_service     BIGINT       REFERENCES public.tb_profile_service(id_profile_service) ON DELETE SET NULL,
  client_name            TEXT,
  client_email           TEXT,
  client_whatsapp        TEXT,
  deposit_cents          INT          NOT NULL CHECK (deposit_cents >= 0),
  platform_fee_cents     INT          NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  professional_cents     INT          NOT NULL CHECK (professional_cents >= 0),
  net_cents              INT          NOT NULL CHECK (net_cents >= 0),
  status                 VARCHAR(20)  NOT NULL DEFAULT 'aguardando'
                           CHECK (status IN ('aguardando','aprovado','pago','revertido')),
  available_at           TIMESTAMPTZ  NOT NULL,
  approved_at            TIMESTAMPTZ,
  paid_out_at            TIMESTAMPTZ,
  paid_out_note          TEXT,
  reverted_at            TIMESTAMPTZ,
  booking_date           DATE,
  booking_start_time     TIME,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_payout_owner
  ON public.tb_booking_payout (id_owner_user, status, available_at);

CREATE INDEX IF NOT EXISTS idx_booking_payout_release
  ON public.tb_booking_payout (status, available_at);

CREATE INDEX IF NOT EXISTS idx_booking_payout_profile
  ON public.tb_booking_payout (id_profile, created_at DESC);

-- ─── Backfill: bookings já pagos sem payout ──────────────────────────────────
INSERT INTO public.tb_booking_payout (
  id_booking, id_profile, id_owner_user, id_profile_service,
  client_name, client_email, client_whatsapp,
  deposit_cents, platform_fee_cents, professional_cents, net_cents,
  status, available_at, approved_at,
  booking_date, booking_start_time, created_at
)
SELECT
  b.id,
  b.id_profile,
  b.profile_owner_user_id,
  b.id_profile_service,
  b.client_name,
  b.client_email,
  b.client_whatsapp,
  b.deposit_amount,
  b.platform_fee_amount,
  b.professional_amount,
  b.professional_amount,
  -- holdback de 8 dias a partir do confirmed_at (não NOW), pra histórico já vencido virar 'aprovado'
  CASE
    WHEN COALESCE(b.confirmed_at, b.created_at) + INTERVAL '8 days' <= NOW() THEN 'aprovado'
    ELSE 'aguardando'
  END,
  COALESCE(b.confirmed_at, b.created_at) + INTERVAL '8 days',
  CASE
    WHEN COALESCE(b.confirmed_at, b.created_at) + INTERVAL '8 days' <= NOW() THEN NOW()
    ELSE NULL
  END,
  b.booking_date,
  b.start_time,
  COALESCE(b.confirmed_at, b.created_at)
FROM public.tb_profile_bookings b
WHERE b.payment_status = 'paid'
  AND b.status IN ('confirmed','completed')
  AND NOT EXISTS (
    SELECT 1 FROM public.tb_booking_payout p WHERE p.id_booking = b.id
  );
