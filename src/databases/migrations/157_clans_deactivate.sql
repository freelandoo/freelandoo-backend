-- =============================================================================
-- Migration 157: Desativa Clans (substituídos por Comunidades)
-- SEM migração. Esconde clans ativos (is_active=FALSE) — o conceito sai do app.
-- Payouts/splits PENDENTES ficam preservados para liquidação manual; nada é
-- deletado. A coluna is_clan e as tabelas tb_clan_* permanecem (inertes) para
-- não quebrar migrations históricas re-executadas no boot. Idempotente.
-- =============================================================================

UPDATE public.tb_profile
   SET is_active = FALSE, updated_at = NOW()
 WHERE is_clan = TRUE
   AND deleted_at IS NULL
   AND is_active = TRUE;
