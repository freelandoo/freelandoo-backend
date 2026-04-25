-- =============================================================================
-- Migration 010: Booking Calendar — agenda, disponibilidade e agendamentos
-- =============================================================================

-- ─── 1. Regras gerais semanais de disponibilidade por perfil ─────────────────
CREATE TABLE IF NOT EXISTS public.tb_profile_availability_rules (
  id              BIGSERIAL       PRIMARY KEY,
  id_profile      UUID            NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  weekday         SMALLINT        NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=dom, 6=sab
  is_enabled      BOOLEAN         NOT NULL DEFAULT FALSE,
  start_time      TIME            NOT NULL DEFAULT '08:00',
  end_time        TIME            NOT NULL DEFAULT '18:00',
  slot_duration_minutes  INT      NOT NULL DEFAULT 60 CHECK (slot_duration_minutes > 0),
  buffer_minutes         INT      NOT NULL DEFAULT 0  CHECK (buffer_minutes >= 0),
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (id_profile, weekday)
);

CREATE INDEX IF NOT EXISTS idx_avail_rules_profile
  ON public.tb_profile_availability_rules (id_profile);

-- ─── 2. Exceções e bloqueios por data específica ────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_profile_availability_overrides (
  id                  BIGSERIAL       PRIMARY KEY,
  id_profile          UUID            NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  override_date       DATE            NOT NULL,
  is_day_blocked      BOOLEAN         NOT NULL DEFAULT FALSE,
  custom_start_time   TIME,
  custom_end_time     TIME,
  extra_slots_json    JSONB,          -- ex: ["09:00","09:30","14:00"]
  blocked_slots_json  JSONB,          -- ex: ["10:00","11:00"]
  note                TEXT,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (id_profile, override_date)
);

CREATE INDEX IF NOT EXISTS idx_avail_overrides_profile_date
  ON public.tb_profile_availability_overrides (id_profile, override_date);

-- ─── 3. Configurações de sinal e agenda por perfil ──────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_profile_booking_settings (
  id                    BIGSERIAL       PRIMARY KEY,
  id_profile            UUID            NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  deposit_amount        INT             NOT NULL DEFAULT 1000 CHECK (deposit_amount >= 1000),
  platform_fee_amount   INT             NOT NULL DEFAULT 1000,
  currency              VARCHAR(3)      NOT NULL DEFAULT 'BRL',
  allow_booking         BOOLEAN         NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (id_profile)
);

-- ─── 4. Agendamentos realizados por clientes ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_profile_bookings (
  id                          BIGSERIAL       PRIMARY KEY,
  id_profile                  UUID            NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  profile_owner_user_id       UUID            NOT NULL,
  client_name                 VARCHAR(200)    NOT NULL,
  client_email                VARCHAR(200)    NOT NULL,
  client_whatsapp             VARCHAR(30),
  booking_date                DATE            NOT NULL,
  start_time                  TIME            NOT NULL,
  end_time                    TIME            NOT NULL,
  status                      VARCHAR(20)     NOT NULL DEFAULT 'pending_payment'
                              CHECK (status IN ('pending_payment','confirmed','canceled','completed','no_show','expired')),
  deposit_amount              INT             NOT NULL,
  platform_fee_amount         INT             NOT NULL DEFAULT 1000,
  professional_amount         INT             NOT NULL,
  stripe_checkout_session_id  VARCHAR(255),
  stripe_payment_intent_id    VARCHAR(255),
  payment_status              VARCHAR(20)     NOT NULL DEFAULT 'pending'
                              CHECK (payment_status IN ('pending','paid','failed','refunded','canceled')),
  confirmed_at                TIMESTAMPTZ,
  canceled_at                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Índice parcial: impedir duplo booking ativo no mesmo slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_unique_active_slot
  ON public.tb_profile_bookings (id_profile, booking_date, start_time)
  WHERE status NOT IN ('canceled', 'expired');

CREATE INDEX IF NOT EXISTS idx_bookings_profile_date
  ON public.tb_profile_bookings (id_profile, booking_date);

CREATE INDEX IF NOT EXISTS idx_bookings_status
  ON public.tb_profile_bookings (status)
  WHERE status = 'pending_payment';

CREATE INDEX IF NOT EXISTS idx_bookings_stripe_session
  ON public.tb_profile_bookings (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
