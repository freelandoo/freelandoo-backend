-- =============================================================================
-- Migration 087 — preço de vagas adicionais do clan: R$50 → R$39
-- =============================================================================
-- Atualiza o default da coluna e migra todos os clans que ainda estão no preço
-- antigo (5000) para o novo (3900). Clans com preço customizado pelo admin não
-- são tocados.
-- =============================================================================

ALTER TABLE public.tb_clan_settings
  ALTER COLUMN slot_price_cents SET DEFAULT 3900;

UPDATE public.tb_clan_settings
   SET slot_price_cents = 3900,
       updated_at = NOW()
 WHERE slot_price_cents = 5000;
