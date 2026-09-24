-- 259_car_per_owner.sql
-- O CARRO DEIXA DE SER "UMA COMUNIDADE POR MODELO" E VIRA "UMA POR CARRO DO DONO".
--
-- Pedido do Alex (2026-09-24): "que a pessoa pudesse cadastrar o carro dela, um
-- ou mais, estilo o meu pet. mas o feed é público, e ter uma opção de filtrar
-- posts por pessoas que tenham o mesmo carro que eu".
--
-- A mig 210 fez o carro COLETIVO: `ux_profile_car_model` garantia UMA
-- comunidade por modelo no site inteiro, e o segundo dono de um Civic entrava
-- na do primeiro. Agora cada pessoa cria a comunidade do próprio carro (quantas
-- quiser, como o pet), e o que junta os donos do mesmo modelo deixa de ser a
-- comunidade e passa a ser o FEED: a página de um carro mostra os posts de todos
-- os carros do site, com o filtro "mesmo carro que o meu".
--
-- ⚠️ O ÍNDICE ÚNICO TEM QUE SAIR, e não é arrumação: com ele de pé, o segundo
-- dono de um Civic que escolhesse o modelo tomaria violação de unicidade.
--
-- O índice COMUM que entra no lugar serve o filtro por modelo, que pergunta
-- "quais comunidades de carro têm este modelo?".
--
-- Sem backfill: em produção existe UMA comunidade de carro (a do Alex, sem
-- modelo e sem posts) — nada a mover.

DROP INDEX IF EXISTS public.ux_profile_car_model;

CREATE INDEX IF NOT EXISTS ix_profile_car_model
  ON public.tb_profile (id_car_model)
  WHERE community_kind = 'car' AND deleted_at IS NULL;
