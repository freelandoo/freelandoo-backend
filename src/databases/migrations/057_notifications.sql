-- =============================================================================
-- Migration 057: Sistema unificado de notificações
-- =============================================================================
-- Uma única tabela cobre todos os tipos: like, comment, follow, message.
-- Receiver sempre é um USER (tb_user.id_user). Origem (actor) opcional —
-- pode ser user (login) e/ou subperfil (entidade que executou a ação).
-- entity_type / entity_id apontam para a coisa relacionada (item de
-- portfolio, conversa, perfil) para permitir deep-link no frontend.
--
-- Lido = read_at IS NOT NULL.
-- Sino na header mostra count de read_at IS NULL.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_notification (
  id_notification     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_recipient_user   UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_recipient_profile UUID NULL REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL,
  type                VARCHAR(40) NOT NULL,
  id_actor_user       UUID NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  id_actor_profile    UUID NULL REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL,
  entity_type         VARCHAR(40) NULL,
  entity_id           UUID NULL,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at             TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tb_notification
  DROP CONSTRAINT IF EXISTS tb_notification_type_chk;
ALTER TABLE public.tb_notification
  ADD CONSTRAINT tb_notification_type_chk
  CHECK (type IN (
    'like_received',
    'comment_received',
    'follow_received',
    'message_received'
  ));

CREATE INDEX IF NOT EXISTS ix_notif_recipient_recent
  ON public.tb_notification (id_recipient_user, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_notif_recipient_unread
  ON public.tb_notification (id_recipient_user, created_at DESC)
  WHERE read_at IS NULL;

-- Dedupe leve: evita 50 entradas idênticas de like quando alguém toggla.
CREATE UNIQUE INDEX IF NOT EXISTS ux_notif_dedupe_like
  ON public.tb_notification (id_recipient_user, type, entity_id, id_actor_user)
  WHERE type = 'like_received'
    AND entity_id  IS NOT NULL
    AND id_actor_user IS NOT NULL
    AND read_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_notif_dedupe_follow
  ON public.tb_notification (id_recipient_user, type, id_actor_user)
  WHERE type = 'follow_received'
    AND id_actor_user IS NOT NULL
    AND read_at IS NULL;

COMMIT;
