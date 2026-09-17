-- =============================================================================
-- Migration 252: A VITRINE VIRA MENSAL — R$ 3,50 por anúncio, no condomínio e
-- na rua. Acaba a cota grátis; quem anuncia paga desde o primeiro anúncio.
--
-- ─── O QUE MUDA DE SIGNIFICADO (é a parte que morde) ─────────────────────────
--
-- Até aqui a mig 198 vendia VAGA: um crédito por (comunidade, morador, tipo)
-- que não expirava, somado contra a cota grátis de 2. Quem tinha prazo era
-- ninguém — o anúncio ficava no ar para sempre.
--
-- Agora quem tem prazo é o ANÚNCIO. Cada linha de `tb_condo_listing` carrega
-- um `paid_until`, e a vitrine mostra `status='active' AND paid_until > NOW()`.
-- Não há sweeper: a vigência é LAZY, lida no SELECT — mesma disciplina do bee
-- (`BEE_ALIVE_SQL`). Um job que "expira anúncios" seria uma segunda verdade
-- sobre a mesma data, e no dia em que ele falhasse a vitrine mostraria anúncio
-- de quem parou de pagar sem ninguém notar.
--
-- ⚠️ VENCER NÃO APAGA NADA. O anúncio some da vitrine e continua inteiro para
-- o dono, que volta a exibi-lo pagando de novo. Cartão recusado não pode
-- destruir o texto, a foto e o preço que a pessoa escreveu.
--
-- ⚠️ `paid_until IS NULL` É "NUNCA FOI PAGO" — é o rascunho. O anúncio nasce
-- assim e só entra na vitrine quando o pagamento confirma. Era a única forma
-- de "pago desde o primeiro" ser verdade: nascendo no ar, o primeiro mês seria
-- de graça para quem publicasse e nunca pagasse.
--
-- ─── DOIS REGIMES DE PAGAMENTO, E ELES NÃO SÃO A MESMA COISA ────────────────
--
-- CARTÃO é assinatura de verdade (`preapproval` do Mercado Pago): renova
-- sozinho e cada fatura paga empurra o `paid_until` em um mês. É o caminho
-- natural do fluxo.
--
-- PIX não tem recorrência no Mercado Pago — o Pix Automático é outro produto e
-- não está habilitado na conta. Então ele COMPRA UM MÊS: paga, o anúncio fica
-- 30 dias no ar, e a renovação é um gesto da pessoa. É por isso que
-- `subscription_ref` é NULL nesse caminho: inventar um id de assinatura ali
-- faria o cancelamento procurar no gateway uma coisa que nunca existiu.
--
-- ⚠️ POR ISSO O ESTADO DA ASSINATURA É NULL-ABLE E NÃO TEM DEFAULT. Sem
-- recorrência não existe "assinatura ativa" nem "assinatura cancelada": existe
-- ausência de assinatura. Um default 'active' faria toda compra por Pix
-- parecer uma assinatura viva que o sweeper da mig 251 tentaria cancelar.
--
-- ─── A TABELA DE VAGAS VIRA A TABELA DE COBRANÇAS ───────────────────────────
--
-- `tb_condo_listing_slot` deixa de ser saldo e passa a ser o histórico de
-- cobranças DO ANÚNCIO (`id_listing` + o período que aquele pagamento cobriu).
-- Ela pôde mudar de significado sem reinterpretar o passado por um fato
-- conferido em produção: ELA ESTÁ VAZIA — nenhuma vaga foi vendida na vida.
--
-- ⚠️ O NOME FICA, e mente a partir de hoje. Mesma disciplina de `tb_machine`
-- (que guarda enxames), `tb_story` (que guarda bees) e `evolution_instance`
-- (que guarda o phone_number_id da Cloud): renomear quebraria a mig 198, que o
-- runner re-executa em banco virgem e cujo checksum ele confere no boot.
--
-- Idempotente.
-- =============================================================================

-- ─── 1. Preço mensal (global + override por comunidade) ─────────────────────
-- Preço em CONSTANTE é a armadilha da mig 244: a tela de admin escrevia num
-- lugar que ninguém lia. Ele nasce aqui, na mesma dupla global/override que a
-- cota já usava, para que mudar R$ 3,50 seja uma linha na tela e não um deploy.
ALTER TABLE public.condo_settings
  ADD COLUMN IF NOT EXISTS listing_monthly_cents INT NOT NULL DEFAULT 350;

ALTER TABLE public.condo_settings
  ADD COLUMN IF NOT EXISTS listing_monthly_polens INT NOT NULL DEFAULT 350;

ALTER TABLE public.condo_settings
  DROP CONSTRAINT IF EXISTS condo_settings_listing_monthly_cents_chk;
ALTER TABLE public.condo_settings
  ADD CONSTRAINT condo_settings_listing_monthly_cents_chk
  CHECK (listing_monthly_cents >= 0);

ALTER TABLE public.condo_settings
  DROP CONSTRAINT IF EXISTS condo_settings_listing_monthly_polens_chk;
ALTER TABLE public.condo_settings
  ADD CONSTRAINT condo_settings_listing_monthly_polens_chk
  CHECK (listing_monthly_polens >= 0);

-- NULL no override = herda o global (o COALESCE de `getEffectiveSettings`).
ALTER TABLE public.tb_condo_config
  ADD COLUMN IF NOT EXISTS listing_monthly_cents INT NULL;

ALTER TABLE public.tb_condo_config
  ADD COLUMN IF NOT EXISTS listing_monthly_polens INT NULL;

ALTER TABLE public.tb_condo_config
  DROP CONSTRAINT IF EXISTS tb_condo_config_listing_monthly_cents_chk;
ALTER TABLE public.tb_condo_config
  ADD CONSTRAINT tb_condo_config_listing_monthly_cents_chk
  CHECK (listing_monthly_cents IS NULL OR listing_monthly_cents >= 0);

ALTER TABLE public.tb_condo_config
  DROP CONSTRAINT IF EXISTS tb_condo_config_listing_monthly_polens_chk;
ALTER TABLE public.tb_condo_config
  ADD CONSTRAINT tb_condo_config_listing_monthly_polens_chk
  CHECK (listing_monthly_polens IS NULL OR listing_monthly_polens >= 0);

-- ─── 2. A cota grátis acaba ─────────────────────────────────────────────────
-- ⚠️ ZERAR, E NÃO APAGAR AS COLUNAS. Elas são o kill-switch da decisão: se um
-- dia a vitrine precisar de um período de cortesia (um mês grátis por morador,
-- um bairro em lançamento), volta a ser um UPDATE em vez de uma migration.
-- A regra de cobrança continua lendo as duas — "grátis = 0" é um caso, não uma
-- exceção no código.
UPDATE public.condo_settings
   SET free_service_listings = 0,
       free_product_listings = 0,
       updated_at            = NOW()
 WHERE id = 1
   AND (free_service_listings <> 0 OR free_product_listings <> 0);

-- Override que ainda dava cota grátis a uma comunidade específica também cai:
-- deixá-lo de pé faria aquele condomínio continuar anunciando de graça, e o
-- sintoma seria "a vitrine não cobra" em um prédio só.
UPDATE public.tb_condo_config
   SET free_service_listings = 0,
       free_product_listings = 0,
       updated_at            = NOW()
 WHERE COALESCE(free_service_listings, 0) <> 0
    OR COALESCE(free_product_listings, 0) <> 0;

-- ─── 3. O anúncio ganha vigência e vínculo com a assinatura ─────────────────
ALTER TABLE public.tb_condo_listing
  ADD COLUMN IF NOT EXISTS paid_until TIMESTAMPTZ NULL;

-- O id do preapproval no gateway. NULL = sem recorrência (Pix, Poléns, ou
-- assinatura já encerrada).
ALTER TABLE public.tb_condo_listing
  ADD COLUMN IF NOT EXISTS subscription_ref TEXT NULL;

ALTER TABLE public.tb_condo_listing
  ADD COLUMN IF NOT EXISTS subscription_provider VARCHAR(16) NULL;

ALTER TABLE public.tb_condo_listing
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(12) NULL;

ALTER TABLE public.tb_condo_listing
  DROP CONSTRAINT IF EXISTS tb_condo_listing_sub_status_chk;
ALTER TABLE public.tb_condo_listing
  ADD CONSTRAINT tb_condo_listing_sub_status_chk
  CHECK (subscription_status IS NULL
         OR subscription_status IN ('active', 'past_due', 'canceled'));

-- ⚠️ O provedor é o MESMO superset histórico das migs 237/250: a coluna
-- descreve o que ela pôde ter tido ao longo da vida do banco, não quem cobra
-- hoje. Quem decide o provedor de cada cobrança é a INTENÇÃO (mig 231).
ALTER TABLE public.tb_condo_listing
  DROP CONSTRAINT IF EXISTS tb_condo_listing_sub_provider_chk;
ALTER TABLE public.tb_condo_listing
  ADD CONSTRAINT tb_condo_listing_sub_provider_chk
  CHECK (subscription_provider IS NULL
         OR subscription_provider IN ('stripe', 'asaas', 'mercadopago'));

-- É por ele que a renovação (invoice paga) acha o anúncio. Parcial porque a
-- imensa maioria das linhas não tem assinatura.
CREATE UNIQUE INDEX IF NOT EXISTS ux_condo_listing_subscription
  ON public.tb_condo_listing (subscription_ref)
  WHERE subscription_ref IS NOT NULL;

-- A varredura do quadro: o filtro de vigência é por `paid_until`, e ele não
-- entra no índice parcial porque NOW() não é imutável.
CREATE INDEX IF NOT EXISTS idx_condo_listing_paid
  ON public.tb_condo_listing (id_condo, kind, paid_until DESC)
  WHERE status = 'active';

-- ─── 4. A cobrança passa a apontar o anúncio que ela paga ───────────────────
ALTER TABLE public.tb_condo_listing_slot
  ADD COLUMN IF NOT EXISTS id_listing BIGINT NULL;

-- ⚠️ CASCADE de propósito: a cobrança só existe por causa do anúncio, e o
-- histórico de dinheiro de verdade mora em `tb_payment_intent` (mig 231), que
-- não depende desta tabela. Um SET NULL deixaria linha de cobrança órfã sem
-- como saber o que ela pagou.
ALTER TABLE public.tb_condo_listing_slot
  DROP CONSTRAINT IF EXISTS tb_condo_listing_slot_listing_fk;
ALTER TABLE public.tb_condo_listing_slot
  ADD CONSTRAINT tb_condo_listing_slot_listing_fk
  FOREIGN KEY (id_listing) REFERENCES public.tb_condo_listing(id_listing)
  ON DELETE CASCADE;

-- Que período este pagamento cobriu. É o que permite responder "até quando eu
-- paguei" sem refazer a conta a partir da data do pagamento.
ALTER TABLE public.tb_condo_listing_slot
  ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ NULL;

ALTER TABLE public.tb_condo_listing_slot
  ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ NULL;

-- Renovação de assinatura não passa por checkout: ela chega como fatura. Sem
-- este campo não haveria como deduplicar a re-entrega do webhook, e o mesmo
-- mês entraria duas vezes empurrando o `paid_until` do assinante para frente.
ALTER TABLE public.tb_condo_listing_slot
  ADD COLUMN IF NOT EXISTS invoice_ref TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_condo_slot_invoice
  ON public.tb_condo_listing_slot (invoice_ref)
  WHERE invoice_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_condo_slot_listing
  ON public.tb_condo_listing_slot (id_listing, created_at DESC)
  WHERE id_listing IS NOT NULL;

-- ─── 5. Cortesia para o que já estava no ar ─────────────────────────────────
-- ⚠️ A DATA FIXA É O QUE TORNA ISTO IDEMPOTENTE. Com `paid_until IS NULL`
-- sozinho, uma segunda execução daria 30 dias de graça a todo anúncio criado
-- depois desta migration e ainda não pago — exatamente os rascunhos que a
-- regra nova existe para cobrar.
--
-- Quem já estava anunciando não pode sair do ar por causa de uma regra que
-- mudou hoje: ele ganha um mês para decidir se assina.
UPDATE public.tb_condo_listing
   SET paid_until = NOW() + INTERVAL '30 days',
       updated_at = NOW()
 WHERE status = 'active'
   AND paid_until IS NULL
   AND created_at < TIMESTAMPTZ '2026-09-17 00:00:00+00';
