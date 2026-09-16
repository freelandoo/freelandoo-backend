-- 251_subscription_end.sql
--
-- "VALE ATÉ O FIM DO CICLO" DEIXA DE DEPENDER DO GATEWAY.
--
-- ─── ⚠️ O DEFEITO QUE ISTO FECHA TIRA MÊS PAGO DE ASSINANTE ─────────────────
--
-- Quatro lugares cancelam assinatura pedindo "no fim do ciclo" (chamam
-- `PaymentGateway.cancelSubscription` SEM `immediate`):
--
--   * CommunityMembershipService  — sair da comunidade privada
--   * PlanService                 — cancelar o Plano Negócio
--   * StripeSubscriptionService   — o usuário cancelando a assinatura do perfil
--   * user/DeleteMeService        — apagar a conta
--
-- No Stripe isso funciona: ele tem `cancel_at_period_end` nativo. Fora dele,
-- NÃO EXISTE — o Asaas só tinha `DELETE` e o Mercado Pago só tem
-- `PUT status=cancelled`, os dois IMEDIATOS. O `immediate: false` chegava ao
-- adapter e era ignorado.
--
-- Resultado sem esta tabela: quem cancela no dia 3 perde o acesso NO DIA 3, com
-- o mês inteiro já pago. E não aparece erro nenhum — a chamada "funciona".
--
-- ─── POR QUE UMA TABELA, E NÃO UMA COLUNA NA ASSINATURA ─────────────────────
--
-- Porque as quatro assinaturas moram em QUATRO tabelas diferentes
-- (`tb_profile_subscription`, `tb_user_plan_subscription`,
-- `tb_atendimento_ia_sub`, `tb_community_member_subscription`). Uma coluna em
-- cada seriam quatro colunas, quatro varreduras e quatro chances de uma delas
-- ficar para trás — e a que ficasse produziria exatamente o defeito de hoje,
-- só numa assinatura específica.
--
-- Aqui o sweeper varre UM lugar, e quem paga a conta é o provedor, não o
-- produto: a agenda é do par (provider, provider_ref), que é o que o gateway
-- entende.
--
-- ⚠️ O ESTADO FINAL É O CANCELAMENTO NO GATEWAY, não a linha daqui. Esta tabela
-- é uma FILA, não a verdade sobre a assinatura — a verdade continua sendo o
-- webhook (`SUBSCRIPTION_ENDED`), que é quem desliga o acesso do lado de cá.
-- Sem essa separação, uma linha 'done' aqui e um cancelamento que falhou lá
-- deixariam a plataforma jurando que a pessoa saiu enquanto o cartão dela segue
-- sendo debitado.

CREATE TABLE IF NOT EXISTS public.tb_subscription_end (
  id_subscription_end UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Em qual gateway cancelar. ⚠️ Guardado, e não derivado na hora: uma
  -- assinatura criada no Stripe tem que ser cancelada no Stripe mesmo depois de
  -- a plataforma inteira migrar. Ler o provedor ativo no dia do vencimento
  -- mandaria o cancelamento para o gateway errado, que responderia "não
  -- encontrado" — e o assinante seguiria sendo cobrado depois de ter cancelado.
  provider            TEXT        NOT NULL,

  -- O id da assinatura NO GATEWAY (o que vive em `stripe_subscription_id`).
  provider_ref        TEXT        NOT NULL,

  -- Só para log e para a tela de suporte. SET NULL: apagar a conta não pode
  -- apagar a ordem de parar de cobrar o cartão dela.
  id_user             UUID        REFERENCES public.tb_user(id_user) ON DELETE SET NULL,

  -- Quando o ciclo pago termina. É a data que a pessoa já pagou.
  cancel_at           TIMESTAMPTZ NOT NULL,

  status              TEXT        NOT NULL DEFAULT 'scheduled',
  reason              TEXT,

  -- ⚠️ Contador de tentativas em coluna PRÓPRIA, não derivado do log: é ele que
  -- permite parar de insistir num id que o gateway não reconhece mais (sem
  -- isso, uma assinatura apagada à mão no painel viraria erro a cada 6h para
  -- sempre).
  attempts            INT         NOT NULL DEFAULT 0,
  last_error          TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at         TIMESTAMPTZ
);

ALTER TABLE public.tb_subscription_end
  DROP CONSTRAINT IF EXISTS tb_subscription_end_provider_chk;
ALTER TABLE public.tb_subscription_end
  ADD CONSTRAINT tb_subscription_end_provider_chk
  CHECK (provider IN ('stripe', 'asaas', 'mercadopago'));

ALTER TABLE public.tb_subscription_end
  DROP CONSTRAINT IF EXISTS tb_subscription_end_status_chk;
ALTER TABLE public.tb_subscription_end
  ADD CONSTRAINT tb_subscription_end_status_chk
  CHECK (status IN ('scheduled', 'done', 'canceled', 'failed'));

-- ⚠️ UMA AGENDA VIVA POR ASSINATURA, e o parcial é o ponto: `scheduled` é
-- único, mas a mesma assinatura pode ter várias linhas históricas (a pessoa
-- cancela, reativa e cancela de novo). Um UNIQUE cego recusaria o segundo
-- cancelamento — e o silêncio faria a pessoa achar que cancelou.
CREATE UNIQUE INDEX IF NOT EXISTS ux_subscription_end_live
  ON public.tb_subscription_end (provider, provider_ref)
  WHERE status = 'scheduled';

-- O radar do sweeper: o que já venceu e ainda não foi executado.
CREATE INDEX IF NOT EXISTS ix_subscription_end_due
  ON public.tb_subscription_end (cancel_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS ix_subscription_end_user
  ON public.tb_subscription_end (id_user, created_at DESC);
