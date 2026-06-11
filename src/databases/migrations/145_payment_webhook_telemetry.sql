-- =============================================================================
-- Migration 145: Telemetria + at-least-once no webhook Stripe (projeto PayDebug)
-- =============================================================================
-- Antes desta mig, tb_stripe_webhook_event marcava processed_at = NOW() no
-- INSERT (idempotência at-most-once): se o processamento falhava no meio, o
-- retry do Stripe caía como "duplicate" e o pagamento nunca era entregue.
--
-- Agora o evento tem ciclo de vida explícito:
--   status   = 'pending' no claim → 'done' só após processar com sucesso
--              → 'failed' se o handler estourar (o retry do Stripe re-processa,
--              porque o claim re-reivindica linhas que não estão 'done').
--   attempts = nº de vezes que o evento foi reivindicado.
--   last_error / completed_at para auditoria e para o painel admin.
--
-- Backfill: linhas antigas já foram processadas no modelo at-most-once →
-- status='done', completed_at = processed_at (a melhor estimativa que temos).

ALTER TABLE public.tb_stripe_webhook_event
  ADD COLUMN IF NOT EXISTS status       TEXT NOT NULL DEFAULT 'done',
  ADD COLUMN IF NOT EXISTS attempts     INT  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_error   TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill idempotente: linhas pré-existentes contam como concluídas.
UPDATE public.tb_stripe_webhook_event
   SET completed_at = COALESCE(completed_at, processed_at)
 WHERE status = 'done' AND completed_at IS NULL;

ALTER TABLE public.tb_stripe_webhook_event
  DROP CONSTRAINT IF EXISTS tb_stripe_webhook_event_status_check;
ALTER TABLE public.tb_stripe_webhook_event
  ADD CONSTRAINT tb_stripe_webhook_event_status_check
  CHECK (status IN ('pending','done','failed'));

-- Radar de eventos travados (status != 'done') para o painel admin de pagamentos.
CREATE INDEX IF NOT EXISTS ix_stripe_webhook_event_unfinished
  ON public.tb_stripe_webhook_event (status, processed_at DESC)
  WHERE status <> 'done';
