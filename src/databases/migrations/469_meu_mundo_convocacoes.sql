-- 469 — Meu Mundo: CONVOCAÇÕES (gachas de fragmentos, gacha-v1, 24/11/2026). Regra pura:
-- src/utils/mmItems/rules/gacha.js. Decisões do Alex: MEU MUNDO 3D/planos/2026-11-24-gachas-fragmentos-proposta.md.
--
--  • tb_mm_gacha_state: o contador de garantia de cada pessoa POR BANNER (weapons/protections/characters):
--      since_rare = giros desde o último Raro-ou-melhor (o 10º força Raro+);
--      since_top  = giros desde o último Topo (o 40º força Topo);
--      guaranteed = Personagens: perdeu o 50/50, o próximo Topo é do alvo;
--      target     = o alvo escolhido (peça de proteção ou personagem); pulls = total de giros.
--    Não zera quando a versão da regra muda. Só o servidor escreve, dentro do withLife (lock da vida).
--  • O giro em si vira RECIBO (tb_mm_receipt, source 'gacha_pull'): a chave do pedido devolve o mesmo
--    resultado para sempre, e o histórico é a lista desses recibos (índice ix_mm_receipt_user_at).
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.tb_mm_gacha_state (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  banner TEXT NOT NULL,
  since_rare INTEGER NOT NULL DEFAULT 0,
  since_top INTEGER NOT NULL DEFAULT 0,
  guaranteed BOOLEAN NOT NULL DEFAULT FALSE,
  target TEXT NULL,
  pulls INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, banner)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mm_gacha_state_banner') THEN
    ALTER TABLE public.tb_mm_gacha_state ADD CONSTRAINT chk_mm_gacha_state_banner CHECK (banner IN ('weapons', 'protections', 'characters'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mm_gacha_state_counts') THEN
    ALTER TABLE public.tb_mm_gacha_state ADD CONSTRAINT chk_mm_gacha_state_counts CHECK (since_rare >= 0 AND since_top >= 0 AND pulls >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_mm_receipt_user_source_at ON public.tb_mm_receipt (id_user, source, created_at DESC);
