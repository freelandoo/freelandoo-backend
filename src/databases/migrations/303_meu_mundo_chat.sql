-- 303_meu_mundo_chat.sql — MEU MUNDO 3D mm3d-32: chat Global do jogo.
--
-- O Global do jogo é UMA sala do chat ao vivo (tb_chat_room) de tipo próprio:
-- as mensagens ficam em tb_chat_message, com a moderação, a denúncia e o painel
-- de hoje. A conversa 1:1 do jogo usa /conversations (perfis-conta) e não
-- precisa de nada aqui. CHECK reescrito como SUPERSET com o mesmo nome.

ALTER TABLE public.tb_chat_room DROP CONSTRAINT IF EXISTS tb_chat_room_type_check;
ALTER TABLE public.tb_chat_room
  ADD CONSTRAINT tb_chat_room_type_check CHECK (type IN ('global','machine','meu_mundo'));

ALTER TABLE public.tb_chat_moderation_settings DROP CONSTRAINT IF EXISTS tb_chat_moderation_settings_room_type_check;
ALTER TABLE public.tb_chat_moderation_settings
  ADD CONSTRAINT tb_chat_moderation_settings_room_type_check CHECK (room_type IN ('global','machine','meu_mundo'));

-- Uma sala ativa do jogo, sem instâncias (o Global do jogo não divide em 100).
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_room_meu_mundo_active
  ON public.tb_chat_room (type)
  WHERE type = 'meu_mundo' AND status = 'active';

INSERT INTO public.tb_chat_moderation_settings (room_type, max_message_length)
VALUES ('meu_mundo', 500)
ON CONFLICT (room_type) DO NOTHING;
