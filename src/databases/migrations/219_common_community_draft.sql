-- =============================================================================
-- Migration 219: a comunidade comum também pode nascer VAZIA
-- =============================================================================
-- Decisão do Alex (2026-09-03): "não quero esse modal (...) quero igual games,
-- já entra a comunidade e deixa tudo editável".
--
-- É a mesma decisão da mig 211, agora para a modalidade 'common'. Lá, pet,
-- carro e games perderam o formulário de criação e passaram a nascer vazios,
-- com o assunto escolhido DENTRO da página, no modo de edição em que o líder já
-- cai. Faltava a comunidade comum, que continuava exigindo nome e enxame num
-- formulário antes de existir — dois lugares para editar a mesma coisa, porque
-- a página já sabe editar nome e bio.
--
-- O QUE MUDA: o enxame (tb_profile.id_machine) da comunidade comum passa a
-- aceitar NULL enquanto ninguém escolheu.
--
-- NULL aqui é "ainda não escolhido", e é diferente de errado. A alternativa
-- seria gravar um enxame qualquer no ato da criação só para satisfazer o CHECK
-- — que é exatamente a patologia da categoria fantasma que a mig 200 teve de
-- desfazer no perfil-conta: dado falso que ninguém declarou e que depois vaza
-- para a vitrine, para a busca e para o ranking como se fosse escolha da
-- pessoa. Melhor a ausência honesta.
--
-- POR QUE ISSO NÃO ESCONDE A COMUNIDADE POR ENGANO: todas as leituras que
-- trazem o enxame já usam LEFT JOIN em tb_machine (CommunityStorage 263, 325,
-- 350, 447, 704, 829), então a linha continua saindo — sem o chip do enxame,
-- que é o que se quer mostrar de um rascunho. Os filtros por enxame simplesmente
-- não a encontram até o líder escolher, que é o comportamento certo: entrar na
-- vitrine de um enxame é consequência de ter escolhido um.
--
-- SUPERSET, como nas migs 204 e 210: as quatro alternativas anteriores ficam
-- palavra por palavra e a última só ganha 'common' na lista de modalidades.
-- Nenhuma linha existente passa a violar o CHECK, e comunidade comum COM enxame
-- (todas as de hoje) continua válida pela terceira alternativa.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

ALTER TABLE public.tb_profile DROP CONSTRAINT IF EXISTS chk_profile_clan_taxonomy;
ALTER TABLE public.tb_profile ADD CONSTRAINT chk_profile_clan_taxonomy CHECK (
  ( is_clan = FALSE AND is_community = FALSE AND id_category IS NOT NULL ) OR
  ( is_clan = TRUE  AND id_machine  IS NOT NULL AND id_category IS NULL ) OR
  ( is_community = TRUE AND id_machine IS NOT NULL AND id_category IS NULL ) OR
  ( is_community = TRUE
    AND community_kind IN ('condo', 'neighborhood', 'pet', 'car', 'games', 'common')
    AND id_category IS NULL )
);
