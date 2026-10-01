-- 271_store_collections_guest_cart.sql
-- COLEÇÕES DA LOJA + CARRINHO DE CONVIDADO (Pinkoracats, 2026-09-30).
--
-- Pedido do Alex: "temos que usar o mercado pago para que as pessoas possam
-- comprar as unhas" — com quatro decisões dele:
--   (1) a dona edita foto, nome e preço e CRIA COLEÇÕES (a prévia de 12 vira
--       coleções de verdade);
--   (2) a entrega é SÓ RETIRADA (a regra da mig 264 continua valendo);
--   (3) o carrinho inteiro vira UM pagamento;
--   (4) quem compra NÃO precisa de conta.
--
-- ═══ COLEÇÃO ═══
-- Pertence ao PERFIL dono da Loja, como o produto. Não é a categoria da
-- plataforma (`tb_product_category`, mig 068): aquela é taxonomia GLOBAL,
-- moderada, que decide política de loja; esta é VITRINE da dona ("New Drop",
-- "Chrome") e muda quando ela quiser. Misturar as duas faria a dona criar
-- categoria global ao arrumar a própria vitrine.
--
-- `deleted_at` em vez de DELETE: apagar a coleção não pode apagar produto, e
-- o produto aponta para ela com SET NULL — o soft delete mantém o histórico
-- e o FK serve ao caso raro de alguém apagar a linha na mão.
--
-- ═══ CARRINHO ═══
-- `tb_store_cart` é o PAGAMENTO; cada item vira uma linha de
-- `tb_profile_product_order` apontando para ele (`id_cart`). É isso que deixa
-- todo o resto da Loja — saldo do vendedor com holdback (`tb_seller_balance`
-- é 1 por pedido), "retirado", extrato, painel de admin — funcionar SEM UMA
-- LINHA DE MUDANÇA. Uma tabela de itens nova obrigaria a reescrever cada um.
--
-- ⚠️ A REFERÊNCIA DE PAGAMENTO MORA SÓ NO CARRINHO. Os pedidos-filhos deixam
-- `stripe_session_id` e `stripe_payment_intent_id` em NULL de propósito: o
-- reembolso da Loja avulsa procura o pedido pelo payment intent e trataria UM
-- filho, deixando os outros pagos. Quem resolve o estorno de carrinho é o
-- `StoreCartService`, que fica na frente da cadeia do webhook.
--
-- ⚠️ `id_buyer_user` PASSA A ACEITAR NULL: é a compradora convidada. Conferido
-- antes: nenhuma leitura faz INNER JOIN no comprador (extrato, admin e saldo
-- leem `buyer_name`/`buyer_email`, que o convidado preenche).

-- ─── Coleções ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_profile_product_collection (
  id_collection  BIGSERIAL    PRIMARY KEY,
  id_profile     UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  name           VARCHAR(60)  NOT NULL CHECK (length(btrim(name)) > 0),
  slug           VARCHAR(60)  NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kicker         VARCHAR(40),
  description    TEXT,
  cover_url      TEXT,
  cover_key      TEXT,
  sort_order     INT          NOT NULL DEFAULT 0,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Endereço único POR LOJA entre as vivas: a página da coleção é
-- `/pagina/<slug>` no site da dona.
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_collection_slug
  ON public.tb_profile_product_collection (id_profile, slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_product_collection_profile
  ON public.tb_profile_product_collection (id_profile, sort_order)
  WHERE deleted_at IS NULL;

ALTER TABLE public.tb_profile_product
  ADD COLUMN IF NOT EXISTS id_collection BIGINT
    REFERENCES public.tb_profile_product_collection(id_collection) ON DELETE SET NULL;

-- Destaque da vitrine: o que a home do site põe na frente. Escolha da dona,
-- não dedução — "mais vendido" pode ser calculado, "o que eu quero mostrar"
-- não pode.
ALTER TABLE public.tb_profile_product
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profile_product_collection
  ON public.tb_profile_product (id_collection)
  WHERE deleted_at IS NULL;

-- ─── Carrinho ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_store_cart (
  id_cart            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_seller_profile  UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE RESTRICT,
  id_seller_user     UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE RESTRICT,
  -- NULL = convidada. Preenchido quando quem comprou estava logado.
  id_buyer_user      UUID         REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  buyer_name         VARCHAR(160) NOT NULL,
  buyer_email        VARCHAR(160) NOT NULL,
  buyer_whatsapp     VARCHAR(40)  NOT NULL,
  note               VARCHAR(500),
  items_count        INT          NOT NULL CHECK (items_count > 0),
  total_cents        INT          NOT NULL CHECK (total_cents >= 0),
  -- De onde a compra veio (o site da comunidade), para o retorno do gateway.
  id_community       UUID         REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL,
  return_url         TEXT,
  provider           VARCHAR(20),
  session_id         TEXT         UNIQUE,
  provider_ref       TEXT,
  payment_intent_id  TEXT,
  charge_id          TEXT,
  checkout_url       TEXT,
  status             VARCHAR(20)  NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','paid','canceled','refunded')),
  paid_at            TIMESTAMPTZ,
  canceled_at        TIMESTAMPTZ,
  refunded_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_cart_seller
  ON public.tb_store_cart (id_seller_user, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_store_cart_payment
  ON public.tb_store_cart (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_store_cart_provider_ref
  ON public.tb_store_cart (provider_ref)
  WHERE provider_ref IS NOT NULL;

ALTER TABLE public.tb_profile_product_order
  ADD COLUMN IF NOT EXISTS id_cart UUID
    REFERENCES public.tb_store_cart(id_cart) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pp_order_cart
  ON public.tb_profile_product_order (id_cart)
  WHERE id_cart IS NOT NULL;

ALTER TABLE public.tb_profile_product_order
  ALTER COLUMN id_buyer_user DROP NOT NULL;
