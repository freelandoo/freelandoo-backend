-- =============================================================================
-- Migration 244: a taxa de agendamento vira CONFIGURÁVEL, o profissional passa
--                a absorver a taxa do gateway, e nasce o "pagar no balcão".
--
-- ── POR QUE ISTO EXISTE ──────────────────────────────────────────────────────
-- A taxa da plataforma no agendamento era `PLATFORM_FEE_CENTS = 1000`, uma
-- CONSTANTE no `BookingService`. Ao mesmo tempo existia (desde a mig 018) uma
-- tela de admin escrevendo em `tb_booking_fee_settings` — que NINGUÉM lia. Em
-- produção ela estava com 5,00% + R$ 2,50 configurados, ou seja: o painel
-- mostrava ao dono da plataforma uma taxa que não era a cobrada. Tela morta é
-- ruim; tela morta que MENTE é pior, porque a pessoa decide preço olhando para
-- ela.
--
-- A partir daqui quem manda é a tabela, e o valor nasce em R$ 1,00 (decisão do
-- Alex, 2026-09-13).
--
-- ⚠️ A TAXA É GLOBAL, e continua sendo. Não existe taxa por profissional nem
-- por comunidade. Mudar `service_fee_cents` muda o que TODO profissional da
-- plataforma recebe por agendamento. Hoje o raio de explosão é zero (conferido
-- em produção: `tb_profile_booking_settings` está vazia, ou seja, ninguém tem
-- agendamento ligado), mas isso deixa de ser verdade no dia em que o segundo
-- cliente entrar.
--
-- ── AS TRÊS MUDANÇAS ─────────────────────────────────────────────────────────
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A TAXA DA PLATAFORMA PASSA A VALER R$ 1,00
--
-- `service_fee_cents` é a parte FIXA e `stripe_fee_percent` a parte
-- PERCENTUAL — as duas somadas são a taxa. O percentual fica em 0: o pedido é
-- R$ 1,00 por agendamento, e um percentual escondido faria a conta do site
-- ("preço na mesa") deixar de fechar com o que o profissional recebe.
--
-- ⚠️ O nome da coluna diz `stripe_`, e isso é LEGADO da mig 018 — ela não tem
-- nada a ver com a tarifa do Stripe nem com a do Asaas (essa é apurada de
-- verdade, ver o item 2). Renomear quebraria a tela de admin que já grava
-- nela; o nome físico fica, como `tb_machine` guarda enxames.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.tb_booking_fee_settings
   SET service_fee_cents  = 100,   -- R$ 1,00
       stripe_fee_percent = 0,
       is_active          = TRUE,
       updated_at         = NOW()
 WHERE id = 1;

-- Rede de segurança: se a linha singleton não existir (banco novo em que a 018
-- rodou e o INSERT foi pulado), ela nasce já no valor certo.
INSERT INTO public.tb_booking_fee_settings (id, stripe_fee_percent, service_fee_cents, is_active)
VALUES (1, 0, 100, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A TAXA DO GATEWAY PASSA A SER DESCONTADA DO PROFISSIONAL
--
-- Antes: o cliente pagava o preço cheio, o profissional recebia `preço − R$10`
-- e a plataforma ficava com os R$10, pagando a tarifa do gateway por dentro.
-- Com a taxa em R$ 1,00 isso viraria PREJUÍZO em todo agendamento: a tarifa do
-- Asaas é R$ 1,99 no Pix e 2,99% + R$ 0,49 no cartão — ou seja, maior que a
-- taxa inteira da plataforma em praticamente toda a tabela de preços.
--
-- Decisão do Alex: quem absorve é o PROFISSIONAL, como já acontece com
-- maquininha. O cliente continua pagando exatamente o preço publicado — que é
-- a promessa central do site do cliente ("preço na mesa") e a única coisa que
-- um gross-up quebraria.
--
-- ⚠️ ESTA COLUNA GUARDA A TAXA REAL, NÃO A ESTIMADA. Na criação ela recebe uma
-- estimativa (a mesma régua admin-editável da Loja), e na CONFIRMAÇÃO ela é
-- substituída pelo valor apurado no gateway (`getChargeFee`: `fee` do Stripe,
-- `value − netValue` do Asaas). `professional_amount` é recalculado junto. É
-- por isso que a estimativa nunca vira dinheiro: o repasse só acontece depois
-- da confirmação.
--
-- DEFAULT 0 e NOT NULL: agendamento antigo (3 linhas em produção) não teve
-- taxa descontada do profissional, e 0 é exatamente essa verdade — nunca NULL,
-- que obrigaria toda leitura de repasse a aprender o caso nulo (e a que
-- esquecesse faria conta com `null`, que em JS vira zero em silêncio).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tb_profile_bookings
  ADD COLUMN IF NOT EXISTS processor_fee_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.tb_profile_bookings
  DROP CONSTRAINT IF EXISTS chk_booking_processor_fee_nonneg;
ALTER TABLE public.tb_profile_bookings
  ADD CONSTRAINT chk_booking_processor_fee_nonneg
  CHECK (processor_fee_cents >= 0);

-- Diz de onde veio o número acima: `fallback` = estimativa da criação,
-- `gateway` = apurado de verdade. Sem isto, um repasse feito com estimativa é
-- indistinguível de um repasse correto — e a diferença é dinheiro do cliente.
ALTER TABLE public.tb_profile_bookings
  ADD COLUMN IF NOT EXISTS processor_fee_source VARCHAR(16) NOT NULL DEFAULT 'fallback';

ALTER TABLE public.tb_profile_bookings
  DROP CONSTRAINT IF EXISTS chk_booking_processor_fee_source;
ALTER TABLE public.tb_profile_bookings
  ADD CONSTRAINT chk_booking_processor_fee_source
  CHECK (processor_fee_source IN ('fallback', 'gateway', 'none'));

-- As 3 linhas que já existem foram cobradas no modelo antigo (plataforma
-- absorvia a tarifa): a taxa do profissional lá é 0 e ela é FINAL, não
-- estimativa. `none` é o que diz isso.
UPDATE public.tb_profile_bookings
   SET processor_fee_source = 'none'
 WHERE processor_fee_cents = 0
   AND processor_fee_source = 'fallback'
   AND created_at < NOW();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. "PAGAR NO BALCÃO" — um `payment_status` novo
--
-- Até aqui existia UM caminho: `createCheckout` sempre, e a reserva só virava
-- confirmada pelo webhook do pagamento. Não havia como marcar horário e pagar
-- na hora do atendimento — que é o costume do ramo e o que o cliente pediu.
--
-- ⚠️ O CHECK É REESCRITO COMO SUPERSET (regra da casa, migs 153/197): a lista
-- nova contém a inteira mais o valor novo. Um CHECK "só com o valor novo"
-- deixaria o antigo valendo em paralelo e recusaria tudo que já existe.
--
-- `on_site` e não `pending`: pendente é cobrança que ainda pode cair, e o
-- sweeper de pendentes expira essas reservas. Aqui não existe cobrança
-- nenhuma para cair — a reserva já está valendo e o dinheiro é combinado fora
-- da plataforma. Marcá-la de `pending` faria o sweeper cancelar sozinho o
-- horário de quem escolheu pagar no balcão.
--
-- ⚠️ NESTE MODO A PLATAFORMA NÃO GANHA NADA, e é aritmética, não escolha: o
-- dinheiro não passa por ela. `platform_fee_amount` e `professional_amount`
-- ficam em 0 — creditar o profissional por dinheiro que a plataforma não
-- recebeu encheria a carteira dele com saldo que ninguém pode sacar.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tb_profile_bookings
  DROP CONSTRAINT IF EXISTS tb_profile_bookings_payment_status_check;
ALTER TABLE public.tb_profile_bookings
  ADD CONSTRAINT tb_profile_bookings_payment_status_check
  CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'canceled', 'on_site'));
