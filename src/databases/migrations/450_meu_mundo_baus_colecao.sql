-- 450 — Meu Mundo, trilha E, fatia E18: BAÚS (um por conta) e COLEÇÃO (itens descobertos).
-- Idempotente. O baú mora num ponto de visita que o servidor já registra (meuMundoPlaces/VISIT_POINTS);
-- abrir grava aqui (a chave primária impede a segunda entrega) e o recibo sai pelo withReceipt.
-- A coleção guarda o PRIMEIRO dia em que cada item entrou na mochila da conta; nasce preenchida pelo
-- livro de itens (mig 446), pelas instâncias e pela pilha antiga.

CREATE TABLE IF NOT EXISTS public.tb_mm_chest_open (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  chest_id TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, chest_id)
);

CREATE TABLE IF NOT EXISTS public.tb_mm_collection (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  first_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, item_id)
);

INSERT INTO public.tb_mm_collection (id_user, item_id, first_at)
SELECT id_user, item_id, MIN(created_at) FROM public.tb_mm_item_ledger WHERE delta > 0 GROUP BY id_user, item_id
ON CONFLICT (id_user, item_id) DO NOTHING;

INSERT INTO public.tb_mm_collection (id_user, item_id, first_at)
SELECT id_user, item_id, MIN(created_at) FROM public.tb_mm_gear_instance GROUP BY id_user, item_id
ON CONFLICT (id_user, item_id) DO NOTHING;

INSERT INTO public.tb_mm_collection (id_user, item_id)
SELECT DISTINCT id_user, item_id FROM public.tb_mm_gear WHERE qty > 0
ON CONFLICT (id_user, item_id) DO NOTHING;
