-- =============================================================================
-- Migration 128: Chat de grupo fixo do clan
-- =============================================================================
-- Cada clan tem uma conversa de grupo (tb_conversation kind='group') ligada via
-- id_clan_profile, criada junto com o clan e sincronizada com a membresia. O
-- frontend fixa essa conversa no topo do /mensagens. Substitui o mural antigo
-- tb_clan_message (aposentado). Idempotente.
-- =============================================================================

ALTER TABLE public.tb_conversation
  ADD COLUMN IF NOT EXISTS id_clan_profile UUID REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE;

-- 1 grupo por clan
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_clan_unique
  ON public.tb_conversation (id_clan_profile)
  WHERE id_clan_profile IS NOT NULL;
