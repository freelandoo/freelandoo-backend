-- =============================================================================
-- Migration 276: FITNESS vira PLATAFORMA — um feed de todo mundo, como games
-- =============================================================================
-- Pedido do Alex (2026-10-09): "transformar a comunidade fitness em uma
-- comunidade igual a todas; a primeira tela é o feed geral de todo mundo que
-- posta coisas fitness".
--
-- A FORMA É A DO FINANCEIRO (229) E DO GAMES (232): UMA linha de `tb_profile`
-- para o site inteiro, garantida pelo banco (índice único sobre expressão
-- constante), sem líder (`id_leader_user` NULL = quem edita é o admin da
-- plataforma) e sem membros (`linkFeedItem` isenta as PLATFORM_KINDS).
--
-- O diário pessoal (calorias, água, refeições, medidas) NÃO muda de lugar no
-- banco — ele continua sendo do USUÁRIO (`tb_food_log`, `tb_water_log`…).
-- O que muda é a tela: a raiz do /fitness passa a ser o feed.
--
-- QUATRO listas fechadas aprendem a modalidade, e todas são reescritas como
-- SUPERSET com o MESMO nome de constraint (regra das migs 153/207):
--   1. chk_profile_community_kind      (a lista de modalidades)
--   2. chk_profile_clan_taxonomy       (fitness, como as outras de assunto, não
--                                       tem enxame nem categoria)
--   3. chk_games_presence_kind         (mig 230 — espelho de PLATFORM_KINDS)
--   4. chk_user_platform_avatar_kind   (mig 233 — idem)
-- As duas últimas não são usadas pela tela hoje, mas PLATFORM_KINDS
-- (utils/gamesScore.js) passa a incluir 'fitness', e o service aceitaria o
-- valor que o banco recusa: o erro apareceria tarde, num INSERT.
-- =============================================================================

ALTER TABLE public.tb_profile DROP CONSTRAINT IF EXISTS chk_profile_community_kind;
ALTER TABLE public.tb_profile ADD CONSTRAINT chk_profile_community_kind
  CHECK (community_kind IN
    ('common', 'academy', 'condo', 'neighborhood', 'pet', 'car', 'games', 'finance', 'fitness'));

ALTER TABLE public.tb_profile DROP CONSTRAINT IF EXISTS chk_profile_clan_taxonomy;
ALTER TABLE public.tb_profile ADD CONSTRAINT chk_profile_clan_taxonomy CHECK (
  ( is_clan = FALSE AND is_community = FALSE AND id_category IS NOT NULL ) OR
  ( is_clan = TRUE  AND id_machine  IS NOT NULL AND id_category IS NULL ) OR
  ( is_community = TRUE AND id_machine IS NOT NULL AND id_category IS NULL ) OR
  ( is_community = TRUE
    AND community_kind IN ('condo', 'neighborhood', 'pet', 'car', 'games', 'common', 'finance', 'fitness')
    AND id_category IS NULL )
);

ALTER TABLE public.tb_games_presence
  DROP CONSTRAINT IF EXISTS chk_games_presence_kind;
ALTER TABLE public.tb_games_presence
  ADD CONSTRAINT chk_games_presence_kind
  CHECK (kind IN ('games', 'finance', 'fitness'));

ALTER TABLE public.tb_user_platform_avatar
  DROP CONSTRAINT IF EXISTS chk_user_platform_avatar_kind;
ALTER TABLE public.tb_user_platform_avatar
  ADD CONSTRAINT chk_user_platform_avatar_kind
  CHECK (kind IN ('games', 'finance', 'fitness'));

-- UMA e só uma.
CREATE UNIQUE INDEX IF NOT EXISTS ux_profile_fitness_singleton
  ON public.tb_profile ((TRUE))
  WHERE community_kind = 'fitness' AND deleted_at IS NULL;

-- Seed. ⚠️ O texto TEM QUE BATER com PLATFORM_SEED em PlatformStorage.js.
-- Idempotente pelo índice acima.
INSERT INTO public.tb_profile (
  id_user, sub_profile_slug, display_name, bio,
  is_community, community_kind, community_privacy,
  is_clan, is_visible, is_active, id_category, id_machine
)
SELECT u.id_user,
       'fitness',
       'Fitness',
       'A plataforma fitness da Freelandoo. Todo mundo lê, todo mundo publica.',
       TRUE, 'fitness', 'public',
       FALSE, TRUE, TRUE, NULL, NULL
  FROM public.tb_user u
 WHERE u.is_admin = TRUE
 ORDER BY u.created_at
 LIMIT 1
ON CONFLICT DO NOTHING;

COMMENT ON INDEX public.ux_profile_fitness_singleton IS
  'Garante que existe NO MÁXIMO UMA plataforma Fitness (mig 276).';
