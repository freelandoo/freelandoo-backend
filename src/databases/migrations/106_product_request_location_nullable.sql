-- 106_product_request_location_nullable.sql
-- Torna city/state opcionais em tb_product_request.
-- Motivo: compradores podem aceitar ofertas de qualquer região (ex.: produtos
-- não-locais como jogos, eletrônicos). Matching usa state/city como filtro
-- só quando informados.

BEGIN;

ALTER TABLE public.tb_product_request
  ALTER COLUMN city DROP NOT NULL;

ALTER TABLE public.tb_product_request
  ALTER COLUMN state DROP NOT NULL;

COMMIT;
