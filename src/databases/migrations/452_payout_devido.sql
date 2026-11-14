-- 452_payout_devido.sql — Segurança A2 (A2-06): estorno DEPOIS do repasse vira dívida ("devido").
--
-- Antes: estorno total com o repasse já PAGO (o admin já mandou o PIX) não registrava nada — o
-- dinheiro saía duas vezes (estorno ao cliente + repasse ao profissional) e ninguém via. A
-- academia já fazia o certo desde a mig 310 (`devido`). Agora os outros seis repasses fazem igual:
-- antes do PIX → 'revertido' (ninguém deve nada); depois → 'devido' (quem recebeu deve; o admin
-- resolve). A vaquinha marcava 'revertido' até repasse PAGO, apagando o pagamento.
--
-- CHECK de status = SUPERSET com o mesmo nome (regra das migrations). Idempotente.

ALTER TABLE public.tb_booking_payout DROP CONSTRAINT IF EXISTS tb_booking_payout_status_check;
ALTER TABLE public.tb_booking_payout ADD CONSTRAINT tb_booking_payout_status_check
  CHECK (status IN ('aguardando', 'aprovado', 'pago', 'revertido', 'devido'));

ALTER TABLE public.tb_clan_payout DROP CONSTRAINT IF EXISTS tb_clan_payout_status_check;
ALTER TABLE public.tb_clan_payout ADD CONSTRAINT tb_clan_payout_status_check
  CHECK (status IN ('aguardando', 'aprovado', 'pago', 'revertido', 'devido'));

ALTER TABLE public.tb_community_delivery_payout DROP CONSTRAINT IF EXISTS tb_community_delivery_payout_status_check;
ALTER TABLE public.tb_community_delivery_payout ADD CONSTRAINT tb_community_delivery_payout_status_check
  CHECK (status IN ('aguardando', 'aprovado', 'pago', 'revertido', 'devido'));

ALTER TABLE public.tb_community_listing_payout DROP CONSTRAINT IF EXISTS tb_community_listing_payout_status_check;
ALTER TABLE public.tb_community_listing_payout ADD CONSTRAINT tb_community_listing_payout_status_check
  CHECK (status IN ('aguardando', 'aprovado', 'pago', 'revertido', 'devido'));

ALTER TABLE public.tb_seller_balance DROP CONSTRAINT IF EXISTS tb_seller_balance_status_check;
ALTER TABLE public.tb_seller_balance ADD CONSTRAINT tb_seller_balance_status_check
  CHECK (status IN ('aguardando', 'aprovado', 'pago', 'revertido', 'devido'));

ALTER TABLE public.tb_vaquinha_payout DROP CONSTRAINT IF EXISTS tb_vaquinha_payout_status_check;
ALTER TABLE public.tb_vaquinha_payout ADD CONSTRAINT tb_vaquinha_payout_status_check
  CHECK (status IN ('aguardando', 'aprovado', 'pago', 'revertido', 'devido'));
