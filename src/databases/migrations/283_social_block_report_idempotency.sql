-- =============================================================================
-- Migration 283: bloqueio entre usuários, denúncia de mensagem direta e envio
-- idempotente de mensagem (Módulo 09 da Freelandoo Arena — a mensageria é da
-- PLATAFORMA, então as três peças nascem aqui e valem para o site inteiro).
-- =============================================================================
-- tb_user_block      — bloqueio SOCIAL entre duas contas. Não é sanção: a
--                      sanção da plataforma continua sendo tb_user.blocked_at.
--                      A identidade canônica é a CONTA (id_user), não o perfil:
--                      quem bloqueia alguém bloqueia todos os perfis dele, e
--                      trocar de perfil não contorna o bloqueio. O perfil por
--                      onde o bloqueio foi feito fica só como rótulo de tela.
--                      Efeito (ConversationService/SocialPolicy): nenhum dos
--                      dois abre conversa direta nem envia mensagem direta
--                      ao outro. O histórico existente NÃO é apagado. Grupos e
--                      salas públicas não mudam (regra explícita do produto).
-- tb_message_report  — denúncia de UMA mensagem direta por quem a recebeu
--                      (participante da conversa). Uma por denunciante e
--                      mensagem; a revisão é da administração da plataforma.
-- tb_message.client_message_id — chave de idempotência do envio: o mesmo
--                      remetente (entidade) na mesma conversa com o mesmo id
--                      é UMA mensagem. Clique repetido, retry e resposta
--                      perdida não duplicam.
--
-- Rollback:
--   DROP TABLE public.tb_message_report, public.tb_user_block;
--   DROP INDEX public.ux_message_client_id;
--   ALTER TABLE public.tb_message DROP COLUMN client_message_id;
--   DELETE FROM public.schema_migrations WHERE filename = '283_social_block_report_idempotency.sql';
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_user_block (
  blocker_user_id  UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  blocked_user_id  UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  via_profile_id   UUID        REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CONSTRAINT chk_user_block_self CHECK (blocker_user_id <> blocked_user_id)
);

-- "Quem me bloqueou" (checagem nos dois sentidos).
CREATE INDEX IF NOT EXISTS ix_user_block_blocked
  ON public.tb_user_block (blocked_user_id, blocker_user_id);

ALTER TABLE public.tb_message ADD COLUMN IF NOT EXISTS client_message_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS ux_message_client_id
  ON public.tb_message (id_conversation, sender_entity_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tb_message_report (
  id_message_report UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  id_message        UUID        NOT NULL REFERENCES public.tb_message(id_message) ON DELETE CASCADE,
  reporter_user_id  UUID        REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  reason_category   VARCHAR(40) NOT NULL,
  reason            VARCHAR(280),
  status            VARCHAR(12) NOT NULL DEFAULT 'pending',
  resolved_by       UUID        REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_message_report_status CHECK (status IN ('pending', 'dismissed', 'actioned')),
  CONSTRAINT chk_message_report_category CHECK (reason_category IN
    ('spam', 'fraud', 'harassment', 'inappropriate', 'hate', 'forbidden_item', 'personal_data', 'other'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_message_report_once
  ON public.tb_message_report (id_message, reporter_user_id)
  WHERE reporter_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_message_report_pending
  ON public.tb_message_report (created_at)
  WHERE status = 'pending';
