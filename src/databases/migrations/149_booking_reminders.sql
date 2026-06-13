-- 149_booking_reminders.sql
-- Lembrete de horário (anti-no-show) v1 — abordagem híbrida sem custo:
-- e-mail automático ao cliente N horas antes + link de confirmação + botão
-- 1-toque wa.me no app (este último é só frontend).
-- Config por subperfil em tb_profile_booking_settings; estado por booking.
-- Idempotente.

ALTER TABLE public.tb_profile_booking_settings
  ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.tb_profile_booking_settings
  ADD COLUMN IF NOT EXISTS reminder_hours_before INTEGER NOT NULL DEFAULT 24;

ALTER TABLE public.tb_profile_bookings
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
ALTER TABLE public.tb_profile_bookings
  ADD COLUMN IF NOT EXISTS confirm_token UUID;
ALTER TABLE public.tb_profile_bookings
  ADD COLUMN IF NOT EXISTS client_confirm_status VARCHAR(20);

-- Constraint do status de confirmação do cliente (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_booking_client_confirm_status'
  ) THEN
    ALTER TABLE public.tb_profile_bookings
      ADD CONSTRAINT chk_booking_client_confirm_status
      CHECK (client_confirm_status IS NULL OR client_confirm_status IN ('confirmed','reschedule'));
  END IF;
END $$;

-- Varredura do job: bookings confirmados ainda sem lembrete.
CREATE INDEX IF NOT EXISTS ix_booking_reminder_due
  ON public.tb_profile_bookings (booking_date, start_time)
  WHERE status = 'confirmed' AND reminder_sent_at IS NULL;

-- Lookup do token de confirmação (link do e-mail).
CREATE UNIQUE INDEX IF NOT EXISTS ux_booking_confirm_token
  ON public.tb_profile_bookings (confirm_token)
  WHERE confirm_token IS NOT NULL;
