-- 300 — MEU MUNDO 3D: vestuário (skins) do personagem (mm3d-16).
--
-- Pedido do Alex (2026-10-21): o personagem PADRÃO muda de corpo pela
-- condição física (magro, normal, gordo, forte — `body`, que sai da vida e
-- NÃO é skin). Uma SKIN é outro visual inteiro (ex.: o Sergio) que se compra
-- com as moedas do jogo e se veste por cima: enquanto vestida, o avatar é o
-- da skin; tirando, volta o padrão na condição de agora.
--
--   tb_mm_avatar_pref.skin  -> o que está vestido ('standard' = o padrão)
--   tb_mm_skin_owned        -> skins compradas (o padrão não tem linha: é de todos)
--
-- O catálogo (ids e preços) mora em src/utils/meuMundoSkins.js; o CHECK abaixo
-- só segura o formato do id. Skin nova = linha no catálogo, sem migration.
--
-- ISOLAMENTO: como as outras tb_mm_*, nada aqui toca saldo, Poléns ou
-- patrimônio da Freelandoo — o preço sai de tb_mm_wallet (moedas do jogo).

ALTER TABLE public.tb_mm_avatar_pref
  ADD COLUMN IF NOT EXISTS skin TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE public.tb_mm_avatar_pref DROP CONSTRAINT IF EXISTS chk_mm_avatar_skin;
ALTER TABLE public.tb_mm_avatar_pref
  ADD CONSTRAINT chk_mm_avatar_skin CHECK (skin ~ '^[a-z0-9-]{1,32}$');

CREATE TABLE IF NOT EXISTS public.tb_mm_skin_owned (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  skin TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0, -- quanto custou (o catálogo pode mudar depois)
  bought_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, skin),
  CONSTRAINT chk_mm_skin_owned_id CHECK (skin ~ '^[a-z0-9-]{1,32}$')
);
