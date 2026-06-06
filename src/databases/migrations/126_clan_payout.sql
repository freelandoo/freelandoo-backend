-- =============================================================================
-- Migration 126: Saldo de split de clan (N membros por venda)
-- =============================================================================
-- Espelha tb_booking_payout (mig 067), mas aceita N linhas por venda — uma por
-- perfil anexado — pra serviços E cursos de clan. Mesma lifecycle e holdback de
-- 8 dias. O leitor de Saldo (/me/booking-payouts) une esta tabela. Substitui a
-- antiga tb_clan_earning_split (write-only), que fica aposentada.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_clan_payout (
  id_clan_payout    BIGSERIAL    PRIMARY KEY,
  id_clan_profile   UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_member_profile UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE RESTRICT,
  id_owner_user     UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE RESTRICT,
  source_type       VARCHAR(20)  NOT NULL CHECK (source_type IN ('clan_service','clan_course')),
  source_id         VARCHAR(64)  NOT NULL,
  gross_cents       INT          NOT NULL CHECK (gross_cents >= 0),
  amount_cents      INT          NOT NULL CHECK (amount_cents >= 0),
  status            VARCHAR(20)  NOT NULL DEFAULT 'aguardando'
                      CHECK (status IN ('aguardando','aprovado','pago','revertido')),
  available_at      TIMESTAMPTZ  NOT NULL,
  approved_at       TIMESTAMPTZ,
  paid_out_at       TIMESTAMPTZ,
  paid_out_note     TEXT,
  reverted_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Idempotência por venda: não duplica o split do mesmo source/membro
CREATE UNIQUE INDEX IF NOT EXISTS idx_clan_payout_source_member
  ON public.tb_clan_payout (source_type, source_id, id_member_profile);

CREATE INDEX IF NOT EXISTS idx_clan_payout_owner
  ON public.tb_clan_payout (id_owner_user, status, available_at);
CREATE INDEX IF NOT EXISTS idx_clan_payout_release
  ON public.tb_clan_payout (status, available_at);
