-- =============================================================================
-- Migration 125: Autor do item de serviço (pra "criador edita o seu, dono modera")
-- =============================================================================
-- Com o clan virando coletivo, qualquer membro cria serviço no clan. Pra impor
-- "cada um edita/exclui o que criou; o dono modera tudo", guardamos quem criou.
-- Itens antigos ficam com created_by_user NULL (tratados como moderáveis só pelo
-- dono — comportamento seguro). Idempotente.
-- =============================================================================

ALTER TABLE public.tb_profile_service
  ADD COLUMN IF NOT EXISTS created_by_user UUID REFERENCES public.tb_user(id_user) ON DELETE SET NULL;
