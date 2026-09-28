-- =============================================================================
-- Migration 265: a taxa da plataforma no agendamento passa a ser 3% do preço.
--
-- Decisão do Alex (2026-09-27): "o agendamento passa a ser 3% da Freelandoo,
-- da casa". Sai o R$ 1,00 fixo da mig 244 e entra o percentual puro.
--
-- O modelo da 244 não muda: o cliente paga o PREÇO PUBLICADO, a plataforma
-- tira a taxa dela, o gateway tira a tarifa dele e o profissional recebe o
-- resto. Só muda QUANTO a plataforma tira.
--
-- ⚠️ `stripe_fee_percent` é nome LEGADO (mig 018): é a parte percentual da
-- taxa DA PLATAFORMA, não a tarifa de gateway nenhum. `utils/bookingFee`
-- calcula `service_fee_cents + preço × stripe_fee_percent / 100`.
--
-- Idempotente: UPDATE com valores fixos, e o INSERT só age se a linha faltar.
-- A tela de admin continua podendo mudar os dois números depois.
-- =============================================================================

UPDATE public.tb_booking_fee_settings
   SET stripe_fee_percent = 3,
       service_fee_cents  = 0,
       is_active          = TRUE,
       updated_at         = NOW()
 WHERE id = 1
   AND (stripe_fee_percent <> 3 OR service_fee_cents <> 0 OR is_active IS DISTINCT FROM TRUE);

INSERT INTO public.tb_booking_fee_settings (id, stripe_fee_percent, service_fee_cents, is_active)
VALUES (1, 3, 0, TRUE)
ON CONFLICT (id) DO NOTHING;
