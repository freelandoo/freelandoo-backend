-- 301 — MEU MUNDO 3D (mm3d-28): geladeira, agenda de refeições e desgaste da vida.
--
-- 1) GELADEIRA: estoque por PESSOA (passa de um hóspede para o próximo, como
--    a carteira). O Mercado do STATUS compra para cá; comer é na geladeira da
--    casa (a sala confere dono e distância). Quantidade nunca negativa.
-- 2) CONSUMO IDEMPOTENTE: cada pedido de comer leva uma chave gerada no
--    cliente. A mesma chave (clique duplo, retry, outra aba reenviando) devolve
--    o resultado gravado e não come de novo. Guardada por 2 dias (limpeza lazy
--    pelo próprio serviço).
-- 3) VIDA: `wear_days` (dias equivalentes de vida já gastos, orçamento de 730)
--    e `exposure` (horas críticas acumuladas de fome, sono, estresse e saúde).
--    NULL = hóspede de antes desta migration: o serviço lê `wear_days` como a
--    idade cronológica até o último instante simulado (viveu bem cuidado até
--    aqui, 1 dia por dia — o mapeamento documentado, sem inventar desgaste) e
--    `exposure` como zero. Nenhuma linha existente é alterada por esta migration.
--    O formato novo de `meals` (registro por id de refeição) é convertido na
--    leitura pela regra (src/utils/meuMundoLife.js `normalize`).
--
-- ISOLAMENTO: moedas e estoque são DO JOGO (ambiente dev), sem relação com
-- saldo, Poléns, Carteira ou patrimônio da Freelandoo.

CREATE TABLE IF NOT EXISTS public.tb_mm_pantry (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, item_id),
  CONSTRAINT chk_mm_pantry_qty CHECK (qty >= 0 AND qty <= 999)
);

CREATE TABLE IF NOT EXISTS public.tb_mm_consume_key (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  key TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, key),
  CONSTRAINT chk_mm_consume_key_len CHECK (char_length(key) BETWEEN 8 AND 64)
);

CREATE INDEX IF NOT EXISTS ix_mm_consume_key_created ON public.tb_mm_consume_key (created_at);

-- Kit inicial da geladeira (uma vez por pessoa).
ALTER TABLE public.tb_mm_wallet ADD COLUMN IF NOT EXISTS pantry_seeded_at TIMESTAMPTZ NULL;

ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS wear_days DOUBLE PRECISION NULL;
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS exposure JSONB NULL;
