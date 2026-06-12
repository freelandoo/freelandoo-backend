-- =============================================================================
-- Migration 146: Blindagem de duplo-crédito de Poléns (projeto PayDebug)
-- =============================================================================
-- Cada fluxo de CRÉDITO (earn) tem um source_id naturalmente único e deve gerar
-- no máximo UMA transação 'posted':
--   earn_purchase_stripe → source_id = stripe session.id   (loja de Poléns)
--   earn_rewarded_ad     → source_id = rewarded_ad_event.id
--   earn_live_gift       → source_id = "<gift_tx>:payout"
--   earn_level_up        → source_id = "<id_profile>:<level>"
--
-- Até aqui o crédito da loja era protegido só por um read-then-check de
-- status='paid' SEM lock (PolenProductService.confirmStripeSession). Com o
-- webhook agora at-least-once (mig 145), dois reprocessamentos concorrentes do
-- mesmo evento podiam passar pelo check e creditar duas vezes. Este índice
-- único parcial é a rede de segurança no nível do banco: a segunda inserção
-- concorrente falha com unique_violation e sua transação inteira faz rollback,
-- preservando o crédito da primeira.
--
-- ESCOPO: só os tipos de crédito acima. Os SPENDs reaproveitam o source_id de
-- propósito (ex.: re-impulsionar o mesmo post → "post_boost:<id>" repetido), por
-- isso NÃO entram aqui — um único em (type, source_id) bloquearia ação legítima.
--
-- Idempotência da própria migration: como já existe o único parcial
-- ux_polen_transactions_source em (source, source_id) WHERE status='posted' e o
-- mapeamento type↔source é 1:1 para os 4 tipos de crédito, é impossível haver
-- duplicatas pré-existentes em (type, source_id) entre as linhas 'posted'. Logo
-- a criação do índice é segura mesmo em bancos com histórico.

CREATE UNIQUE INDEX IF NOT EXISTS ux_polen_tx_credit_dedupe
  ON public.polen_transactions (type, source_id)
  WHERE source_id IS NOT NULL
    AND status = 'posted'
    AND type IN (
      'earn_purchase_stripe',
      'earn_rewarded_ad',
      'earn_live_gift',
      'earn_level_up'
    );
