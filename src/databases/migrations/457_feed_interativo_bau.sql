-- =============================================================================
-- Migration 457 — Feed Interativo F3: Baú (presente que cai no feed)
-- =============================================================================
-- O baú é um tb_feed_drop kind='gift' (mig 456). O CONTEÚDO é escolhido por
-- quem envia (mensagem curta, figurinha do catálogo fixo, reação surpresa) e
-- fica no payload — a surpresa é só de quem recebe. Nada de moeda/cupom: Gold
-- vale R$ 1 (mig 329) e presente com valor sorteado é loot box. O modo "na
-- sorte" sorteia QUEM recebe, nunca o que vem dentro.
--
-- tb_feed_sticker_owned: a coleção de figurinhas de quem abriu baús.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_feed_sticker_owned (
  id_user       UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  sticker_id    TEXT NOT NULL,
  qty           INTEGER NOT NULL DEFAULT 1,
  first_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_from     UUID NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  PRIMARY KEY (id_user, sticker_id),
  CONSTRAINT tb_feed_sticker_owned_qty_chk CHECK (qty >= 1)
);

-- Um baú abre uma vez: a coleção conta pelo drop, não pelo clique.
ALTER TABLE public.tb_feed_drop
  ADD COLUMN IF NOT EXISTS reward_applied BOOLEAN NOT NULL DEFAULT FALSE;
