-- =============================================================================
-- Migration 164: Documentos para emissão de etiqueta em produção (Melhor Envio)
-- =============================================================================
-- O Melhor Envio em produção valida CPF/CNPJ (dígitos verificadores) do
-- REMETENTE e do DESTINATÁRIO, além de exigir número de endereço de origem.
-- O schema não coletava nenhum desses dados — purchaseLabel.js já LÊ estes
-- campos (seller.origin_document/origin_number/origin_complement e
-- order.buyer_document), mas eles nunca eram populados. Esta migration cria as
-- colunas; a coleta/validação vive no service + frontend (settings + checkout).
-- Idempotente.
-- =============================================================================

-- ─── Origem do vendedor (subperfil) ────────────────────────────────────────────
ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS origin_document   VARCHAR(14),
  ADD COLUMN IF NOT EXISTS origin_number     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS origin_complement VARCHAR(120);

COMMENT ON COLUMN public.tb_profile.origin_document IS
  'CPF (11 díg.) ou CNPJ (14 díg.) do remetente — apenas dígitos. Obrigatório para emitir etiqueta no Melhor Envio em produção.';
COMMENT ON COLUMN public.tb_profile.origin_number IS
  'Número do endereço de origem do frete. Obrigatório pelo Melhor Envio.';
COMMENT ON COLUMN public.tb_profile.origin_complement IS
  'Complemento do endereço de origem do frete (opcional).';

-- ─── Documento do comprador (por pedido) ───────────────────────────────────────
ALTER TABLE public.tb_profile_product_order
  ADD COLUMN IF NOT EXISTS buyer_document VARCHAR(14);

COMMENT ON COLUMN public.tb_profile_product_order.buyer_document IS
  'CPF/CNPJ do destinatário — apenas dígitos. Coletado no checkout; obrigatório para emitir etiqueta no Melhor Envio em produção.';
