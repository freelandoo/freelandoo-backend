-- 270_user_public_pills.sql
-- O OLHO DO GERENCIADOR DE PILLS: o que o VISITANTE vê atrás da foto.
--
-- Pedido do Alex (2026-09-28): no "Gerenciar pills", além de escolher e trocar
-- de lugar, um olho decide se carro, pet, games, business e fitness aparecem
-- para o PÚBLICO. Tudo nasce invisível, menos o business — "não tem razão só
-- para o games ficar pra todo mundo".
--
-- NULL = "nunca escolheu" → vale o padrão (só business). Lista vazia é escolha
-- ("nenhum pill público"). Chaves validadas em `utils/quickPills.js`, não por
-- CHECK (a lista cresce quando nasce espaço novo).
--
-- Quem aplica é o BACKEND (`GET /public/users/:handle/spaces`): o espaço
-- escondido não sai na resposta, então o visitante não descobre que ele existe.
ALTER TABLE public.tb_user
  ADD COLUMN IF NOT EXISTS public_pills TEXT[] NULL;
