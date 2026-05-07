-- =============================================================================
-- Migration 027: Mensagens internas (Direct) entre subperfis e clans
-- =============================================================================
-- Sistema de conversas 1-a-1 polimórfico entre entidades em tb_profile.
-- Como clan e subperfil são ambos linhas em tb_profile (discriminados por
-- is_clan), o entity_type é único = 'profile' por enquanto. O campo é mantido
-- para evolução (ex: 'group' no futuro) e a chave canônica usa o prefixo.
--
-- Conversation key canônica: "profile:<uuid_a>|profile:<uuid_b>" com
-- entity_a_id < entity_b_id (ordem lexicográfica) para garantir unicidade
-- da relação independente de quem iniciou.
--
-- Soft-delete via deleted_at (padrão do projeto).
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Conversas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_conversation (
  id_conversation                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_key                 VARCHAR(160) NOT NULL,
  entity_a_type                    VARCHAR(16)  NOT NULL DEFAULT 'profile',
  entity_a_id                      UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  entity_b_type                    VARCHAR(16)  NOT NULL DEFAULT 'profile',
  entity_b_id                      UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  last_message_at                  TIMESTAMPTZ  NULL,
  last_message_preview             VARCHAR(200) NULL,
  last_message_sender_entity_type  VARCHAR(16)  NULL,
  last_message_sender_entity_id    UUID         NULL,
  created_at                       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at                       TIMESTAMPTZ  NULL,
  CONSTRAINT tb_conversation_entity_a_type_chk
    CHECK (entity_a_type IN ('profile')),
  CONSTRAINT tb_conversation_entity_b_type_chk
    CHECK (entity_b_type IN ('profile')),
  CONSTRAINT tb_conversation_no_self_chk
    CHECK (entity_a_id <> entity_b_id),
  CONSTRAINT tb_conversation_canonical_order_chk
    CHECK (entity_a_id < entity_b_id)
);

-- Unicidade da relação ativa (permite recriar após soft-delete)
CREATE UNIQUE INDEX IF NOT EXISTS ux_conversation_key_active
  ON public.tb_conversation (conversation_key)
  WHERE deleted_at IS NULL;

-- Lookup por participante para listar conversas do usuário
CREATE INDEX IF NOT EXISTS idx_conversation_entity_a_recent
  ON public.tb_conversation (entity_a_type, entity_a_id, last_message_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_entity_b_recent
  ON public.tb_conversation (entity_b_type, entity_b_id, last_message_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Participantes (estado por entidade dentro da conversa)
-- ─────────────────────────────────────────────────────────────────────────────
-- Mantém unread_count e last_read_at por entidade. A row é criada junto com a
-- conversa para ambos os lados; quando o lado "lê" a thread, unread_count zera
-- e last_read_at é atualizado. Mensagens entrantes incrementam unread_count do
-- lado oposto.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_conversation_participant (
  id_conversation_participant  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_conversation              UUID         NOT NULL REFERENCES public.tb_conversation(id_conversation) ON DELETE CASCADE,
  entity_type                  VARCHAR(16)  NOT NULL DEFAULT 'profile',
  entity_id                    UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  unread_count                 INT          NOT NULL DEFAULT 0,
  last_read_at                 TIMESTAMPTZ  NULL,
  created_at                   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at                   TIMESTAMPTZ  NULL,
  CONSTRAINT tb_conversation_participant_entity_type_chk
    CHECK (entity_type IN ('profile')),
  CONSTRAINT tb_conversation_participant_unread_nonneg_chk
    CHECK (unread_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_conversation_participant_active
  ON public.tb_conversation_participant (id_conversation, entity_type, entity_id)
  WHERE deleted_at IS NULL;

-- Para somar unread total por entidade (badge no header)
CREATE INDEX IF NOT EXISTS idx_conversation_participant_unread
  ON public.tb_conversation_participant (entity_type, entity_id, unread_count)
  WHERE deleted_at IS NULL AND unread_count > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Mensagens
-- ─────────────────────────────────────────────────────────────────────────────
-- sender_entity_* identifica QUEM (qual subperfil/clan) está falando;
-- sender_user_id identifica qual usuário humano apertou enviar (auditoria
-- importante quando clans tiverem múltiplos owners no futuro).
--
-- status v1 só usa 'sent'. Campos 'delivered'/'read' ficam preparados para
-- evolução; o estado de leitura "consumível" pelo destinatário hoje é
-- last_read_at no participant (mais barato de manter).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_message (
  id_message          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  id_conversation     UUID         NOT NULL REFERENCES public.tb_conversation(id_conversation) ON DELETE CASCADE,
  sender_entity_type  VARCHAR(16)  NOT NULL DEFAULT 'profile',
  sender_entity_id    UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  sender_user_id      UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  body                TEXT         NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  status              VARCHAR(16)  NOT NULL DEFAULT 'sent',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ  NULL,
  CONSTRAINT tb_message_sender_entity_type_chk
    CHECK (sender_entity_type IN ('profile')),
  CONSTRAINT tb_message_status_chk
    CHECK (status IN ('sent','delivered','read'))
);

-- Listagem de mensagens da thread (ordem cronológica)
CREATE INDEX IF NOT EXISTS idx_message_conversation_recent
  ON public.tb_message (id_conversation, created_at DESC, id_message DESC)
  WHERE deleted_at IS NULL;

-- Para detectar última mensagem por sender (auditoria/duplicação)
CREATE INDEX IF NOT EXISTS idx_message_sender_recent
  ON public.tb_message (sender_entity_type, sender_entity_id, created_at DESC)
  WHERE deleted_at IS NULL;

COMMIT;
