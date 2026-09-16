-- 250_mercadopago_provider.sql
--
-- OS CINCO CHECKS QUE AINDA NÃO CONHECEM O MERCADO PAGO.
--
-- ─── POR QUE ISTO É UMA MIGRATION SÓ, E NÃO CINCO ───────────────────────────
--
-- Porque elas falham em MOMENTOS DIFERENTES do fluxo de dinheiro, e alargar
-- umas e esquecer outras é o pior caminho possível:
--
--   * `tb_payment_intent.provider` falha no passo (1) do PaymentGateway, ANTES
--     de qualquer ida à rede. Inofensivo: ninguém é cobrado.
--   * `payment_provider` do delivery e da vitrine falham no `attachCharge`, que
--     roda DEPOIS do `createCheckout`. Aí a cobrança já está de pé no Mercado
--     Pago e não existe linha nenhuma aqui — pagamento cobrado, sem dono e sem
--     entrega, que é exatamente o que a ordem das três escritas da mig 231
--     existe para evitar.
--
-- Alargar as cinco junto é o que mantém essa garantia inteira.
--
-- ─── 'asaas' E 'stripe' FICAM, COMO VALORES HISTÓRICOS ──────────────────────
--
-- Mesma decisão da mig 247 com 'evolution': o CHECK descreve o que a coluna
-- PODE conter ao longo da vida do banco, não quem cobra hoje. Tirá-los
-- obrigaria a decidir o que fazer com uma eventual linha antiga, e as saídas
-- são todas ruins (converter mente sobre quem cobrou, apagar leva o histórico
-- de dinheiro junto, falhar derruba o boot). Quem decide quem cobra é o
-- registry do PaymentGateway, não a constraint.
--
-- ⚠️ LARGURA CONFERIDA EM PRODUÇÃO ANTES DE ESCREVER, porque um CHECK que passa
-- e uma coluna que trunca dão o mesmo sintoma tarde: 'mercadopago' tem 11
-- caracteres e as três colunas de provedor são VARCHAR(16); 'mercadopago_fee'
-- tem 15 e `tb_profile_product_order.processor_fee_source` é VARCHAR(20).
-- Nenhum ALTER TYPE é necessário.

-- ── 1. A intenção (mig 231) ─────────────────────────────────────────────────
-- Nome explícito desde a 231 — é ele, e não o convencional.
ALTER TABLE public.tb_payment_intent
  DROP CONSTRAINT IF EXISTS tb_payment_intent_provider_check;
ALTER TABLE public.tb_payment_intent
  ADD CONSTRAINT tb_payment_intent_provider_check
  CHECK (provider IN ('stripe','asaas','mercadopago'));

-- ── 2. A telemetria de webhook (mig 231) ────────────────────────────────────
ALTER TABLE public.tb_stripe_webhook_event
  DROP CONSTRAINT IF EXISTS tb_stripe_webhook_event_provider_check;
ALTER TABLE public.tb_stripe_webhook_event
  ADD CONSTRAINT tb_stripe_webhook_event_provider_check
  CHECK (provider IN ('stripe','asaas','mercadopago'));

-- ── 3. A vaga de anúncio de condomínio (migs 198/237) ───────────────────────
-- ⚠️ O DROP varre o catálogo pela COLUNA, e não pelo nome. A 198 declarou o
-- CHECK INLINE (nome gerado pelo Postgres) e a 237 o renomeou; apostar em um
-- dos dois nomes e errar deixaria a constraint antiga de pé EM PARALELO — o
-- ALTER passaria, a migration seria dada como aplicada, e o primeiro INSERT
-- com 'mercadopago' ainda seria recusado em produção.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cls.relnamespace
     WHERE ns.nspname = 'public'
       AND cls.relname = 'tb_condo_listing_slot'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%payment_provider%'
  LOOP
    EXECUTE format('ALTER TABLE public.tb_condo_listing_slot DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.tb_condo_listing_slot
  ADD CONSTRAINT tb_condo_listing_slot_provider_chk
  CHECK (payment_provider IN ('stripe', 'asaas', 'mercadopago', 'polens', 'admin_grant'));

-- ── 4. O delivery entre vizinhos (mig 248) ──────────────────────────────────
-- Mesmo cuidado: o CHECK da 248 é INLINE na coluna.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cls.relnamespace
     WHERE ns.nspname = 'public'
       AND cls.relname = 'tb_community_delivery_request'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%payment_provider%'
  LOOP
    EXECUTE format('ALTER TABLE public.tb_community_delivery_request DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- ⚠️ O `IS NULL` continua na frente, e não é redundância: o chamado nasce SEM
-- provedor (`payment_status='none'`), porque a mig 248 cobra no ACEITE e não na
-- abertura. Sem essa perna, abrir um chamado passaria a violar a constraint.
ALTER TABLE public.tb_community_delivery_request
  ADD CONSTRAINT tb_community_delivery_request_payment_provider_check
  CHECK (payment_provider IS NULL
         OR payment_provider IN ('stripe', 'asaas', 'mercadopago'));

-- ── 5. A venda na vitrine (mig 249) ─────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cls.relnamespace
     WHERE ns.nspname = 'public'
       AND cls.relname = 'tb_community_listing_order'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%payment_provider%'
  LOOP
    EXECUTE format('ALTER TABLE public.tb_community_listing_order DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.tb_community_listing_order
  ADD CONSTRAINT tb_community_listing_order_payment_provider_check
  CHECK (payment_provider IS NULL
         OR payment_provider IN ('stripe', 'asaas', 'mercadopago'));

-- ── 6. A taxa REAL da Loja (migs 074/237) ───────────────────────────────────
--
-- ⚠️ ISTO SAI DO BOLSO DO VENDEDOR: `processor_fee_cents` é descontado do
-- repasse. Sem um valor que diga "esta taxa foi APURADA no Mercado Pago", toda
-- venda cobrada por lá ficaria presa na ESTIMATIVA — que está calibrada para a
-- tarifa do Stripe. O índice parcial da 074, que varre quem ficou em
-- 'fallback', continua sendo o radar de quem nunca foi apurado.
--
-- `processor_fee_source` do delivery, da vitrine e do agendamento NÃO entra
-- aqui de propósito: lá os valores são 'none'/'fallback'/'gateway', que já são
-- AGNÓSTICOS de provedor. Quem diz qual gateway apurou é `payment_provider`.
ALTER TABLE public.tb_profile_product_order
  DROP CONSTRAINT IF EXISTS tb_profile_product_order_processor_src_chk;

ALTER TABLE public.tb_profile_product_order
  ADD CONSTRAINT tb_profile_product_order_processor_src_chk
  CHECK (processor_fee_source IN ('fallback', 'stripe_balance_tx', 'asaas_fee', 'mercadopago_fee', 'manual'));
