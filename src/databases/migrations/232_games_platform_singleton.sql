-- =============================================================================
-- Migration 232: GAMES vira UMA plataforma só — e o que é da PESSOA sai dela
-- =============================================================================
-- Pedido do Alex (2026-09-09): "o games e o financeiro são plataformas e só o
-- admin da plataforma pode alterar; para todo mundo o feed é público e
-- comunitário, e as cores só o admin pode alterar" — e, logo depois, a régua
-- que separa as duas metades: "o feed é da plataforma; a estante, jogo atual e
-- posts são do perfil do usuário, a mesma coisa da carteira e da vaquinha; só o
-- feed é público".
--
-- ─── O QUE ESTAVA NO AR, E POR QUE NÃO ERA ISSO ─────────────────────────────
--
-- A mig 210 fez games ser UM ESPAÇO POR PESSOA (como pet e carro): quem apertava
-- "Meus games" criava o seu. A entrega de 2026-09-07 deu a ele cara de
-- plataforma — sem membros, com dock e pele próprios —, mas por dentro ele
-- continuou sendo a comunidade de uma pessoa. Três consequências:
--
--   1. o FEED NÃO ERA COMUNITÁRIO. `linkFeedItem` exige membresia, e como
--      ninguém entra em games (o botão Entrar sumiu), só o dono publicava lá.
--   2. QUEM EDITAVA ERA O DONO — nome, foto e CORES eram do líder do espaço, e
--      não do admin da plataforma.
--   3. o JOGO ATUAL estava pendurado na COMUNIDADE (`tb_community_game`), o que
--      só fazia sentido quando a comunidade era de uma pessoa. Numa plataforma
--      de todos, "o jogo do espaço" seria o jogo da casa aparecendo como se
--      fosse o de cada visitante.
--
-- ─── A FORMA: A MESMA DO FINANCEIRO (mig 229) ───────────────────────────────
--
-- Uma linha só para o site inteiro, garantida pelo BANCO e não pelo código:
-- índice único sobre expressão constante. Sem ele, duas primeiras aberturas
-- simultâneas criariam dois "Games" e os posts se dividiriam entre dois murais
-- — e ninguém perceberia por semanas.
--
-- E, como lá, a plataforma NÃO TEM LÍDER: `id_leader_user` fica NULL. Isso não
-- é escrituração, é o GATE: o front e o service perguntam "sou o líder?" para
-- desenhar e aceitar edição, e com NULL a resposta é não para todo mundo. Quem
-- edita passa a ser o ADMIN DA PLATAFORMA, verificado no service
-- (`CommunityService._assertCommunityAdmin`). O `id_user` continua preenchido
-- porque a coluna é NOT NULL.
--
-- ─── DUPLICATAS ─────────────────────────────────────────────────────────────
--
-- Em produção há EXATAMENTE UMA comunidade de games (conferido em 2026-09-09),
-- então o bloco de fusão abaixo é no-op lá. Ele existe porque uma migration que
-- FALHA derruba o boot (`runner.js` sai com exit 1): se algum ambiente tiver
-- duas, o índice único não pode ser a primeira coisa a descobrir isso. A mais
-- antiga vence e recebe os posts das outras; as outras são soft-deleted.
-- =============================================================================

-- ─── 0) Fotografia do mundo ANTES de mexer em qualquer coisa ────────────────
-- ⚠️ A ORDEM AQUI NÃO É ESTILO. O passo 4 troca o dono da plataforma, e o
-- backfill do jogo atual precisa do dono ORIGINAL de cada espaço — lido depois,
-- o jogo de todo mundo iria parar na conta do admin.
CREATE TEMP TABLE _games_platform ON COMMIT DROP AS
  SELECT id_profile
    FROM public.tb_profile
   WHERE is_community = TRUE
     AND community_kind = 'games'
     AND deleted_at IS NULL
   ORDER BY created_at, id_profile
   LIMIT 1;

CREATE TEMP TABLE _games_extras ON COMMIT DROP AS
  SELECT p.id_profile
    FROM public.tb_profile p
   WHERE p.is_community = TRUE
     AND p.community_kind = 'games'
     AND p.deleted_at IS NULL
     AND p.id_profile NOT IN (SELECT id_profile FROM _games_platform);

CREATE TEMP TABLE _games_subject ON COMMIT DROP AS
  SELECT p.id_user, g.platform, g.game_title, g.gamertag
    FROM public.tb_community_game g
    JOIN public.tb_profile p ON p.id_profile = g.id_profile
   WHERE p.community_kind = 'games'
     AND p.deleted_at IS NULL;

-- ─── 1) O JOGO ATUAL passa a ser da PESSOA ──────────────────────────────────
-- Mesma leitura da Carteira dentro do Financeiro: a plataforma é o feed; o que
-- responde "o que EU estou jogando" é do usuário e o acompanha, independente de
-- qual tela ele abra. Chave é o `id_user` — um jogo atual por pessoa, que é o
-- que "atual" quer dizer.
--
-- Colunas nulas de propósito (mig 211 já tinha soltado as da tabela antiga):
-- NULL = "ainda não escolhi", e é o que a tela mostra como rascunho.
CREATE TABLE IF NOT EXISTS public.tb_user_current_game (
  id_user     UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  platform    VARCHAR(24)  NULL,
  game_title  VARCHAR(120) NULL,
  gamertag    VARCHAR(60)  NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_current_game_platform CHECK (
    platform IS NULL OR platform IN
      ('pc', 'playstation', 'xbox', 'nintendo', 'mobile', 'retro', 'outra')
  )
);

-- Backfill: o jogo que estava no espaço de cada um vira o jogo daquela pessoa.
-- `DO NOTHING` porque a pessoa pode (em tese) ter dois espaços — fica o mais
-- antigo, que é o que a fusão também escolhe.
INSERT INTO public.tb_user_current_game (id_user, platform, game_title, gamertag)
SELECT s.id_user, s.platform, s.game_title, s.gamertag
  FROM _games_subject s
ON CONFLICT (id_user) DO NOTHING;

-- A tabela antiga deixa de ter dono e deixa de ser lida. Apagar as linhas (e
-- não a tabela) é a mesma disciplina de `tb_machine`/`tb_story`: o nome físico
-- é legado e o DROP quebraria migrations históricas que a referenciam. Sem as
-- linhas, não há como o "jogo da casa" reaparecer como se fosse o de alguém.
DELETE FROM public.tb_community_game g
 USING public.tb_profile p
 WHERE p.id_profile = g.id_profile
   AND p.community_kind = 'games';

-- ─── 2) Fusão: os posts das outras passam para a plataforma ─────────────────
-- O `NOT EXISTS` respeita `ux_community_feed_item` (um item aparece no máximo
-- uma vez por comunidade); o que sobra é apagado logo abaixo, senão a linha
-- ficaria apontando para uma comunidade que deixou de existir.
UPDATE public.tb_community_feed_item f
   SET id_community_profile = (SELECT id_profile FROM _games_platform)
 WHERE f.id_community_profile IN (SELECT id_profile FROM _games_extras)
   AND NOT EXISTS (
     SELECT 1
       FROM public.tb_community_feed_item g
      WHERE g.id_community_profile = (SELECT id_profile FROM _games_platform)
        AND g.id_portfolio_item = f.id_portfolio_item
   );

DELETE FROM public.tb_community_feed_item
 WHERE id_community_profile IN (SELECT id_profile FROM _games_extras);

-- Post marcado como exclusivo de um espaço que vai sumir passa a ser exclusivo
-- da plataforma — apontando para o espaço apagado, ele sumiria do feed geral E
-- do mural, ficando visível só para o autor.
UPDATE public.tb_profile_portfolio_item
   SET id_exclusive_community = (SELECT id_profile FROM _games_platform)
 WHERE id_exclusive_community IN (SELECT id_profile FROM _games_extras);

UPDATE public.tb_profile
   SET deleted_at = NOW(), updated_at = NOW()
 WHERE id_profile IN (SELECT id_profile FROM _games_extras);

-- ─── 3) Ninguém "é membro" de uma plataforma ────────────────────────────────
-- O Financeiro tem zero linhas em `tb_community_member`, e é isso que faz o
-- botão Sair não existir por lá. Games herda a mesma verdade: quem entrou
-- quando o espaço era pessoal deixa de ter vínculo — ele não dava nem tirava
-- nada (a plataforma está fora do XP e do ranking de comunidades).
DELETE FROM public.tb_community_member m
 USING public.tb_profile p
 WHERE p.id_profile = m.id_community_profile
   AND p.community_kind = 'games';

-- ─── 4) A linha que sobrou passa a ser a plataforma ─────────────────────────
UPDATE public.tb_profile p
   SET id_leader_user = NULL,
       id_user = COALESCE(
         (SELECT u.id_user FROM public.tb_user u ORDER BY u.is_admin DESC, u.created_at LIMIT 1),
         p.id_user
       ),
       updated_at = NOW()
 WHERE p.id_profile IN (SELECT id_profile FROM _games_platform);

-- O nome só é trocado enquanto ainda for o rascunho ("Meus games", o
-- PLACEHOLDER_NAME da mig 210) — a mesma regra que a 211 já usava para não
-- renomear por cima do que alguém escreveu. "Meus" era verdade quando o espaço
-- era de uma pessoa; agora ele é de todas.
UPDATE public.tb_profile
   SET display_name = 'Games',
       bio = COALESCE(NULLIF(bio, ''),
                      'A plataforma de games da Freelandoo. Todo mundo lê, todo mundo publica.'),
       updated_at = NOW()
 WHERE id_profile IN (SELECT id_profile FROM _games_platform)
   AND display_name = 'Meus games';

-- O slug é único POR USUÁRIO, então a troca é guardada: se o dono já tiver um
-- perfil com slug 'games', a plataforma fica com o que já tinha. Slug de
-- comunidade não é endereço de nada aqui (ela abre por UUID) — não vale
-- derrubar o boot por causa dele.
UPDATE public.tb_profile p
   SET sub_profile_slug = 'games'
 WHERE p.id_profile IN (SELECT id_profile FROM _games_platform)
   AND p.sub_profile_slug IS DISTINCT FROM 'games'
   AND NOT EXISTS (
     SELECT 1
       FROM public.tb_profile o
      WHERE o.id_user = p.id_user
        AND o.id_profile <> p.id_profile
        AND o.sub_profile_slug = 'games'
   );

-- ─── 5) A garantia: uma só, para sempre ─────────────────────────────────────
-- Índice único sobre expressão CONSTANTE — o mesmo desenho de
-- `ux_profile_finance_singleton` (mig 229). Duas linhas vivas de `games` viram
-- violação de unicidade no Postgres, e o get-or-create do storage usa isso para
-- transformar a corrida em no-op.
CREATE UNIQUE INDEX IF NOT EXISTS ux_profile_games_singleton
  ON public.tb_profile ((TRUE))
  WHERE is_community = TRUE AND community_kind = 'games' AND deleted_at IS NULL;
