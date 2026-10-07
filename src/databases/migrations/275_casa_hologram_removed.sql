-- =============================================================================
-- Migration 275: holograma da Casa Views pode ser REMOVIDO da vitrine (admin)
-- =============================================================================
-- Pedido do Alex (2026-10-07): administrador tira o colecionável da própria
-- vitrine para repetir o fluxo da RA (colecionar → materializar → vitrine)
-- quantas vezes quiser. A linha não é apagada: vira `removed` e sai da vitrine
-- (que lê só `paid`). Só a rota de admin escreve este status.
--
-- Idempotente.
-- =============================================================================

ALTER TABLE public.tb_casa_hologram_purchase
  DROP CONSTRAINT IF EXISTS chk_casa_hologram_status;

ALTER TABLE public.tb_casa_hologram_purchase
  ADD CONSTRAINT chk_casa_hologram_status
  CHECK (status IN ('pending', 'paid', 'expired', 'refunded', 'removed'));
