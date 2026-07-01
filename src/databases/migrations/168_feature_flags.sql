-- =============================================================================
-- Migration 168: Feature flags (Painel de Controle do admin)
-- =============================================================================
-- Chave de liga/desliga por "responsabilidade" do produto. Desligar uma flag
-- esconde toda a superfície da responsabilidade no frontend E bloqueia as rotas
-- correspondentes no backend (403). Os dados NÃO são apagados — só ficam ocultos
-- até religar. Pedidos/pagamentos já em andamento continuam liquidando (webhook
-- e repasses NÃO são gated).
--
-- Cada linha = uma responsabilidade. A primeira é a Loja/Produtos.
-- Idempotente (CREATE ... IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_feature_flag (
  flag_key    TEXT         PRIMARY KEY,
  label       TEXT         NOT NULL,
  description TEXT         NULL,
  is_enabled  BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by  UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);

-- Seed da responsabilidade "Lojas / Produtos".
INSERT INTO public.tb_feature_flag (flag_key, label, description, is_enabled)
VALUES (
  'store',
  'Lojas / Produtos',
  'Vitrine de produtos: aba Loja nos perfis, aba Produtos na busca, detalhe e compra de produto, carrinho, checkout, gestão de produtos no Account e "Pedir Produto". Desligar esconde tudo isso (dados preservados) e bloqueia as rotas no backend. Pedidos já em andamento continuam liquidando. O admin da Loja continua acessível.'
)
ON CONFLICT (flag_key) DO NOTHING;
