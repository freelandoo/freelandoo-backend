-- 307 — WhatsApp oficial do SISTEMA DA ACADEMIA (o Coliseu) pela Freelandoo.
--
-- Pedido do Alex (2026-10-26): o número da academia passa para a Cloud API,
-- cadastrado na Freelandoo, e o ATENDIMENTO acontece só no Coliseu — a
-- Freelandoo é a ponte (recebe da Meta e repassa; envia o que o Coliseu manda).
--
-- ⚠️ CONTINUA SENDO ATENDIMENTO, NÃO DISPARO: o Coliseu só responde dentro da
-- janela de 24h a quem escreveu (a conferência é a MESMA do WhatsappService) e
-- nunca usa template. É a regra que sustenta o portfólio da Freelandoo perante
-- a Meta — e o número de todos os clientes junto.

-- 1. O número que atende pela academia. O dono liga o número DELE à academia
--    (um número por academia); a ingestão passa a repassar em vez de mostrar
--    na caixa e de chamar a IA.
ALTER TABLE public.tb_whatsapp_instance
  ADD COLUMN IF NOT EXISTS id_academy_forward UUID NULL
    REFERENCES public.tb_academy(id_academy) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_instance_academy_forward
  ON public.tb_whatsapp_instance (id_academy_forward)
  WHERE id_academy_forward IS NOT NULL;

-- 2. Para onde repassar: o webhook do sistema da academia e o segredo da
--    assinatura (selado em utils/secretBox.js, como o token da Gym API).
ALTER TABLE public.tb_academy
  ADD COLUMN IF NOT EXISTS whatsapp_webhook_url TEXT NULL;
ALTER TABLE public.tb_academy
  ADD COLUMN IF NOT EXISTS whatsapp_webhook_secret_sealed TEXT NULL;

-- 3. O id da mídia na Meta (o W4b que estava pendente): a Cloud API só baixa
--    mídia pelo `media_id` do webhook, nunca pelo id da mensagem. Sem ele,
--    foto e áudio recebidos ficavam sem como abrir.
ALTER TABLE public.tb_whatsapp_message
  ADD COLUMN IF NOT EXISTS media_id VARCHAR(128) NULL;

-- 4. A fila do repasse. A ingestão só ENFILEIRA (SQL) e tenta entregar na
--    hora; o que falhar volta pelo sweeper com espera crescente. Entrega é
--    at-least-once — o Coliseu deduplica pelo wa_message_id.
CREATE TABLE IF NOT EXISTS public.tb_whatsapp_forward_delivery (
  id_delivery      BIGSERIAL    PRIMARY KEY,
  id_academy       UUID         NOT NULL REFERENCES public.tb_academy(id_academy) ON DELETE CASCADE,
  payload          JSONB        NOT NULL,
  attempts         SMALLINT     NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  delivered_at     TIMESTAMPTZ  NULL,
  failed_at        TIMESTAMPTZ  NULL,
  last_error       TEXT         NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_whatsapp_forward_due
  ON public.tb_whatsapp_forward_delivery (next_attempt_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;
