-- 142: atributos estruturados no chamado de produto (espelha os subfiltros
-- da Loja — mig 139). O comprador detalha o que procura (ex.: plataforma
-- "PlayStation 5", condição "Usado") com o MESMO schema de
-- lib/product-attributes do frontend. Formato: { chave: ["valor", ...] }.
ALTER TABLE public.tb_product_request
  ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '{}'::jsonb;
