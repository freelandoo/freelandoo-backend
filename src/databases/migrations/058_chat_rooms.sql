-- Migration 058 — Chat global e por máquina (MMORPG-style)
--
-- Quatro tabelas:
--   tb_chat_room          — salas com instâncias automáticas (max 100 users)
--   tb_chat_presence      — presença online (heartbeat via last_seen_at)
--   tb_chat_message       — mensagens (suporta soft delete e emojis unicode)
--   tb_chat_report        — denúncias de mensagens
--
-- Idempotente: rodável várias vezes sem efeitos colaterais.

CREATE TABLE IF NOT EXISTS public.tb_chat_room (
  id_chat_room     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             VARCHAR(20) NOT NULL CHECK (type IN ('global','machine')),
  id_machine       INTEGER REFERENCES public.tb_machine(id_machine) ON DELETE CASCADE,
  instance_number  INTEGER NOT NULL DEFAULT 1,
  max_users        INTEGER NOT NULL DEFAULT 100,
  status           VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  display_name     TEXT,
  internal_name    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Apenas 1 sala ativa por (type=global, instance_number)
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_room_global_instance
  ON public.tb_chat_room (instance_number)
  WHERE type = 'global' AND status = 'active';

-- Apenas 1 sala ativa por (machine, instance_number)
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_room_machine_instance
  ON public.tb_chat_room (id_machine, instance_number)
  WHERE type = 'machine' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_chat_room_type_status
  ON public.tb_chat_room (type, status);

-- ------------------------------------------------------------
-- Presença
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tb_chat_presence (
  id_chat_presence UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_chat_room     UUID NOT NULL REFERENCES public.tb_chat_room(id_chat_room) ON DELETE CASCADE,
  id_user          UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_presence_room_user
  ON public.tb_chat_presence (id_chat_room, id_user);

CREATE INDEX IF NOT EXISTS idx_chat_presence_room_seen
  ON public.tb_chat_presence (id_chat_room, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_presence_user
  ON public.tb_chat_presence (id_user);

-- ------------------------------------------------------------
-- Mensagens
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tb_chat_message (
  id_chat_message UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_chat_room    UUID NOT NULL REFERENCES public.tb_chat_room(id_chat_room) ON DELETE CASCADE,
  id_user         UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_profile      UUID REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL,
  content         TEXT NOT NULL,
  message_type    VARCHAR(20) NOT NULL DEFAULT 'text'
                   CHECK (message_type IN ('text','system','profile_share','service_share','course_share')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chat_message_room_created
  ON public.tb_chat_message (id_chat_room, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_message_user_recent
  ON public.tb_chat_message (id_user, created_at DESC);

-- ------------------------------------------------------------
-- Denúncias
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tb_chat_report (
  id_chat_report      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_chat_message     UUID NOT NULL REFERENCES public.tb_chat_message(id_chat_message) ON DELETE CASCADE,
  id_reporter_user    UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  reason              TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','reviewed','dismissed','actioned')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_report_message_reporter
  ON public.tb_chat_report (id_chat_message, id_reporter_user);

CREATE INDEX IF NOT EXISTS idx_chat_report_status
  ON public.tb_chat_report (status, created_at DESC);
