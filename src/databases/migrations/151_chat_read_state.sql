-- =============================================================================
-- Migration 151: Estado de "não-lido" do chat ao vivo (Global + Enxames)
-- =============================================================================
-- O chat ao vivo é efêmero (reseta todo dia) e baseado em presença — não tinha
-- como saber "tem conversa nova que eu não vi". Esta tabela guarda, por usuário
-- e por ESCOPO, quando ele leu pela última vez. Escopo (não a instância da sala):
--   'global'         → todas as salas globais
--   'machine:<id>'   → todas as salas de um enxame
--
-- "Tem não-lido no escopo X" = existe mensagem (de outra pessoa) numa sala ativa
-- do escopo X criada depois do last_read_at do usuário. Como as mensagens somem
-- no reset diário, o não-lido zera junto naturalmente.

CREATE TABLE IF NOT EXISTS public.tb_chat_read (
  id_user       UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  scope         VARCHAR(40) NOT NULL,
  last_read_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, scope)
);

CREATE INDEX IF NOT EXISTS ix_chat_read_user
  ON public.tb_chat_read (id_user);
