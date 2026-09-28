-- =============================================================================
-- Migration 264: perfil, pet e carro ADICIONAIS por R$9,99 vitalício — e a Loja
-- volta, só com RETIRADA combinada com o vendedor
-- =============================================================================
-- Decisão do Alex (2026-09-27):
--   "Perfil adicional, tanto no principal como em pets e carros, é 9,99
--    vitalício. E volte a loja para os perfis, porém a loja é retire com o
--    vendedor, negociam a retirada."
--
-- ─── 1. O PREÇO É UM SÓ, E MORA ONDE JÁ MORAVA ──────────────────────────────
--
-- A ativação do perfil adicional sempre leu `tb_annual_fee_settings` (a tela
-- de admin edita essa linha). O pet e o carro adicionais leem a MESMA linha
-- (SpaceSlotService): "perfil adicional" é um preço só, e uma segunda tabela
-- de preço faria o admin mudar um e esquecer o outro.
--
-- Poléns acompanham pela régua de sempre (1 Polén = R$0,01).
--
-- ─── 2. PET E CARRO: O PRIMEIRO É GRÁTIS, O PAGAMENTO É A VAGA ───────────────
--
-- `tb_space_slot_purchase` guarda cada vaga paga. A regra (SpaceSlotService):
-- a pessoa pode ter vivos `1 + vagas pagas` espaços daquela modalidade. O
-- confirmador do pagamento JÁ CRIA o espaço (o pagamento é a existência) e
-- grava `id_profile` na linha — é por ela que a tela de retorno descobre
-- para onde levar a pessoa.
--
-- Apagar um pet libera a vaga: o limite conta espaços VIVOS, então o próximo
-- nasce sem cobrar de novo.
--
-- ─── 3. A LOJA: SÓ RETIRADA ──────────────────────────────────────────────────
--
-- A flag `store` foi desligada no Painel de Controle em 2026-09-09; volta
-- ligada. Todo produto vira `local_pickup` e o pedido ganha `delivery_mode`
-- explícito — a fila de etiquetas do Melhor Envio passa a olhar só os pedidos
-- de ENVIO, senão tentaria comprar etiqueta para pedido sem endereço.
-- `destination_zipcode` perde o NOT NULL: retirada não tem destino.
--
-- Idempotente.
-- =============================================================================

-- ─── 1. Preço do perfil adicional ────────────────────────────────────────────
UPDATE public.tb_annual_fee_settings
   SET amount_cents = 999, updated_at = NOW()
 WHERE id = 1 AND amount_cents <> 999;

UPDATE public.polen_settings
   SET price_profile_activation = 999
 WHERE price_profile_activation IS DISTINCT FROM 999;

-- ─── 2. Vagas de pet e carro ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_space_slot_purchase (
  id                     BIGSERIAL PRIMARY KEY,
  id_user                UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  kind                   VARCHAR(10) NOT NULL,
  amount_cents           INTEGER NOT NULL DEFAULT 0,
  status                 VARCHAR(12) NOT NULL DEFAULT 'pending',
  stripe_session_id      VARCHAR(255) NULL,
  stripe_payment_intent  VARCHAR(255) NULL,
  id_profile             UUID NULL REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL,
  paid_at                TIMESTAMPTZ NULL,
  refunded_at            TIMESTAMPTZ NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_space_slot_kind   CHECK (kind IN ('pet', 'car')),
  CONSTRAINT chk_space_slot_status CHECK (status IN ('pending', 'paid', 'expired', 'refunded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_space_slot_session
  ON public.tb_space_slot_purchase (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_space_slot_user_kind
  ON public.tb_space_slot_purchase (id_user, kind)
  WHERE status = 'paid' AND refunded_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_space_slot_payment_intent
  ON public.tb_space_slot_purchase (stripe_payment_intent)
  WHERE stripe_payment_intent IS NOT NULL;

-- ─── 3. A Loja volta, só com retirada ────────────────────────────────────────
UPDATE public.tb_feature_flag
   SET is_enabled = TRUE,
       description = 'Vitrine de produtos: aba Loja nos perfis, aba Produtos na busca, detalhe e compra de produto e "Pedir Produto". Toda venda é RETIRADA com o vendedor: sem frete, o comprador paga na plataforma e os dois combinam a retirada na conversa que abre sozinha. Desligar esconde tudo isso (dados preservados) e bloqueia as rotas no backend. Pedidos já em andamento continuam liquidando.',
       updated_at = NOW()
 WHERE flag_key = 'store';

UPDATE public.tb_profile_product
   SET delivery_mode = 'local_pickup'
 WHERE delivery_mode IS DISTINCT FROM 'local_pickup';

ALTER TABLE public.tb_profile_product_order
  ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(20) NOT NULL DEFAULT 'shipping';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_product_order_delivery_mode') THEN
    ALTER TABLE public.tb_profile_product_order
      ADD CONSTRAINT chk_product_order_delivery_mode
      CHECK (delivery_mode IN ('shipping', 'local_pickup'));
  END IF;
END $$;

ALTER TABLE public.tb_profile_product_order
  ALTER COLUMN destination_zipcode DROP NOT NULL;
