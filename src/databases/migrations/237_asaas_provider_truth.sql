-- 237_asaas_provider_truth.sql
--
-- DOIS CHECKS QUE AINDA NÃO CONHECIAM O ASAAS — e um deles é dinheiro.
--
-- ─── 1. A VAGA DE ANÚNCIO DE CONDOMÍNIO ─────────────────────────────────────
--
-- `tb_condo_listing_slot.payment_provider` tinha CHECK fechado em
-- ('stripe','polens','admin_grant'). Com a cobrança no Asaas, gravar a verdade
-- ali VIOLARIA a constraint — e é por isso que o código escrevia 'stripe' fixo,
-- o que mantinha o INSERT de pé ao preço de registrar o provedor errado.
--
-- ─── 2. A TAXA REAL DA LOJA ─────────────────────────────────────────────────
--
-- `processor_fee_source` (mig 074) só aceitava 'fallback', 'stripe_balance_tx'
-- e 'manual'. Não havia valor para dizer "esta é a taxa REAL, apurada no
-- Asaas", então toda venda da Loja cobrada por lá fica presa na taxa ESTIMADA
-- — e a estimativa está calibrada para a tarifa do Stripe.
--
-- ⚠️ ISSO SAI DO BOLSO DO VENDEDOR, e não do nosso: o `processor_fee_cents` é
-- descontado do repasse. Enquanto a tarifa real do Asaas for MENOR que a
-- estimativa, a plataforma retém a diferença de cada venda sem que ninguém
-- perceba; sendo MAIOR, a plataforma paga a diferença. Este valor é o que
-- permite ao caminho de apuração existir; o índice parcial da 074, que varre
-- quem ficou em 'fallback', continua sendo o radar de quem nunca foi apurado.

-- ── 1 ───────────────────────────────────────────────────────────────────────
--
-- ⚠️ O CHECK da 198 é INLINE na coluna, então o nome dele foi gerado pelo
-- Postgres. Apostar no nome convencional e errar deixaria a constraint ANTIGA
-- de pé em paralelo — o ALTER passaria, a migration seria dada como aplicada, e
-- o primeiro INSERT com 'asaas' ainda seria recusado em produção. Por isso o
-- DROP varre o catálogo pela COLUNA, e não pelo nome.
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
  CHECK (payment_provider IN ('stripe', 'asaas', 'polens', 'admin_grant'));

-- ── 2 ───────────────────────────────────────────────────────────────────────
-- Aqui o nome é explícito desde a 074 — e é ele, não o convencional.
ALTER TABLE public.tb_profile_product_order
  DROP CONSTRAINT IF EXISTS tb_profile_product_order_processor_src_chk;

ALTER TABLE public.tb_profile_product_order
  ADD CONSTRAINT tb_profile_product_order_processor_src_chk
  CHECK (processor_fee_source IN ('fallback', 'stripe_balance_tx', 'asaas_fee', 'manual'));
