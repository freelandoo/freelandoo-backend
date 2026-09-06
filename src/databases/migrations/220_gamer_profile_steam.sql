-- =============================================================================
-- Migration 220: Perfil gamer — conta de plataforma, catálogo de jogos, estante
-- =============================================================================
-- Decisão do Alex (2026-09-06): o pill roxo "Games" do headcard precisa servir
-- para COMPARAR progresso, e o primeiro corte é com dado VERIFICADO — Steam.
-- A estante CONVIVE com a comunidade "Meus games" (o pill continua abrindo a
-- comunidade; a estante é uma aba dentro dela).
--
-- ─── POR QUE A CONTA É DO USUÁRIO, E NÃO DA COMUNIDADE ──────────────────────
--
-- `tb_community_game` (mig 210) guarda o ASSUNTO de um espaço: um chip de
-- plataforma, um título e um nick, tudo digitado. Pendurar a conexão da Steam
-- ali seria repetir o erro que a agenda (mig 190) e o CPF (mig 188) já
-- pagaram: quem tem dois perfis conectaria duas vezes e a mesma biblioteca
-- viraria duas verdades. Biblioteca é da PESSOA. Por isso `id_user`.
--
-- E são coisas diferentes de propósito: `tb_community_game.platform` é o
-- ASSUNTO do espaço ('retro', 'mobile', 'outra'); `provider` aqui é a CONTA
-- conectada ('steam'). Unificar os dois "para simplificar" quebraria a
-- modalidade — quem joga na Steam e no PS5 tem UM perfil gamer com DUAS
-- contas, e o chip não sabe representar isso.
--
-- ─── POR QUE NÃO EXISTE COLUNA DE TOKEN ─────────────────────────────────────
--
-- A Steam não entrega token nenhum: o login dela é OpenID 2.0, que só PROVA
-- que aquele SteamID é da pessoa. Quem lê a biblioteca depois é a nossa chave
-- global (`STEAM_WEB_API_KEY`), e o que limita a leitura é a privacidade que o
-- dono escolheu na Steam — não um escopo que a gente guarda.
--
-- Uma coluna `token_sealed` vazia aqui seria um convite: o provedor seguinte
-- (Xbox via OpenXBL, que TEM chave por usuário) a encontraria pronta e alguém
-- guardaria credencial de outra plataforma sem passar pela decisão de guardar.
-- Quando esse dia chegar, ele traz a coluna dele, selada pelo `secretBox`.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
--
-- SEM BACKFILL, e não por descuido: em produção existe UMA comunidade de games
-- e ela está vazia (platform/game_title/gamertag todos NULL). Não há estante
-- para reconstruir nem usuário para preservar.
-- =============================================================================

-- ─── 1. A conta conectada ───────────────────────────────────────────────────
-- `external_id` é o identificador NA PLATAFORMA (o SteamID64, 17 dígitos). Ele
-- é a identidade; `handle` é só o apelido de exibição e muda quando a pessoa
-- quiser.
--
-- `status` e não um booleano `conectado`, pela mesma razão do domínio próprio
-- (mig 214): o ciclo tem estados que pedem instrução DIFERENTE na tela.
--   connected        → lendo normalmente
--   needs_permission → a conta existe e é nossa, mas o dono deixou os detalhes
--                      de jogo privados na Steam. NÃO é erro, é uma escolha
--                      dele — e a tela tem que dizer onde mudar, não mostrar
--                      "falha ao sincronizar".
--   error            → a plataforma respondeu errado (fora do ar, chave
--                      recusada). Some sozinho no próximo sync.
--
-- A unicidade é do vínculo VIVO (`revoked_at IS NULL`), padrão da mig 203:
--   • um usuário tem no máximo UMA conta por provedor;
--   • uma conta da plataforma pertence a no máximo UM usuário — sem isto,
--     "conquistas verificadas" não valeria nada, porque duas contas Freelandoo
--     poderiam reivindicar o mesmo perfil da Steam.
-- Desconectar carimba `revoked_at` em vez de apagar a linha: é o histórico que
-- mostra que aquele SteamID já esteve aqui, e libera o par para quem for o
-- dono de verdade.
CREATE TABLE IF NOT EXISTS public.tb_user_game_account (
  id_account    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user       UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  provider      VARCHAR(24) NOT NULL,
  external_id   VARCHAR(64) NOT NULL,
  handle        VARCHAR(120) NULL,
  avatar_url    TEXT NULL,
  profile_url   TEXT NULL,
  status        VARCHAR(24) NOT NULL DEFAULT 'connected',
  -- Visibilidade da ESTANTE. Duas opções e não três: "só quem eu acompanho"
  -- exigiria um grafo user→user que não existe (o follow é user→perfil), e um
  -- meio-termo que ninguém entende esconderia justamente o que a pessoa
  -- conectou para mostrar. Quem conecta escolhe na hora, escrito na tela.
  visibility    VARCHAR(16) NOT NULL DEFAULT 'public',
  sync_error    TEXT NULL,
  last_sync_at  TIMESTAMPTZ NULL,
  connected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ NULL,
  CONSTRAINT chk_user_game_account_provider CHECK (provider IN ('steam')),
  CONSTRAINT chk_user_game_account_status CHECK
    (status IN ('connected', 'needs_permission', 'error')),
  CONSTRAINT chk_user_game_account_visibility CHECK
    (visibility IN ('public', 'private'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_game_account_live
  ON public.tb_user_game_account (id_user, provider)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_game_account_external_live
  ON public.tb_user_game_account (provider, external_id)
  WHERE revoked_at IS NULL;

-- Quem está vencido de sync. Índice parcial porque conta revogada não
-- sincroniza nunca mais e não pode pesar na varredura.
CREATE INDEX IF NOT EXISTS ix_user_game_account_sync
  ON public.tb_user_game_account (last_sync_at)
  WHERE revoked_at IS NULL;

-- ─── 2. O catálogo de jogos ─────────────────────────────────────────────────
-- O jogo deixa de ser texto e vira REFERÊNCIA. É isso, e não a tela, que torna
-- a comparação possível: "Elden Ring", "elden ring" e "ELDEN RING " são o
-- mesmo `slug` e portanto a mesma linha.
--
-- O catálogo NASCE DO USO e não de uma importação: a primeira biblioteca
-- sincronizada cria as linhas que faltam. Importar um catálogo global (IGDB
-- cobra parceria comercial; RAWG idem) seria pagar por 300 mil jogos para
-- servir os 80 que a base tem — e amarrar a feature a um contrato antes de ela
-- provar que alguém a usa.
--
-- `cover_url` é montada pelo provedor (a Steam serve a arte por appid, sem
-- custar chamada de API). Fica gravada porque a comparação lista dezenas de
-- capas de uma vez e não pode depender de o provedor estar de pé.
CREATE TABLE IF NOT EXISTS public.tb_game (
  id_game     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        VARCHAR(160) NOT NULL,
  name        VARCHAR(200) NOT NULL,
  cover_url   TEXT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_game_slug ON public.tb_game (slug);

-- ─── 3. A ponte provedor → jogo ─────────────────────────────────────────────
-- O appid 1245620 da Steam É o Elden Ring; um dia o mesmo jogo chega pelo Xbox
-- com outro id. Sem esta tabela, o mesmo jogo viraria duas linhas de catálogo
-- e a comparação diria que vocês não têm nada em comum.
--
-- A ponte é SEPARADA do catálogo (e não uma coluna `steam_appid` em `tb_game`)
-- porque coluna por provedor faz a tabela crescer de largura a cada plataforma
-- nova — e obriga migration para algo que devia ser linha.
CREATE TABLE IF NOT EXISTS public.tb_game_provider_ref (
  provider     VARCHAR(24) NOT NULL,
  external_id  VARCHAR(64) NOT NULL,
  id_game      UUID NOT NULL REFERENCES public.tb_game(id_game) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, external_id)
);

CREATE INDEX IF NOT EXISTS ix_game_provider_ref_game
  ON public.tb_game_provider_ref (id_game);

-- ─── 4. A estante ───────────────────────────────────────────────────────────
-- Uma linha por (pessoa, jogo, PROVEDOR) — e o provedor está na chave de
-- propósito.
--
-- ⚠️ NUNCA SOMAR PROVEDORES. Quem tem The Witcher 3 na Steam e no PSN tem duas
-- linhas, e a tela mostra "142h (Steam)". Somar horas de fontes que medem de
-- jeitos diferentes produz um número que não corresponde a nada — e o Xbox,
-- quando entrar, não devolve horas nenhuma: a soma viraria mentira silenciosa.
--
-- CONQUISTAS SÃO CACHE, NÃO SYNC. A Steam cobra UMA CHAMADA POR JOGO para
-- conquistas (`GetPlayerAchievements`), e o teto do ToS é 100.000 chamadas por
-- dia na chave inteira: sincronizar conquistas de 300 jogos por pessoa gastaria
-- a cota do dia em 300 usuários. Por isso `ach_*` só é preenchido quando
-- alguém ABRE aquele jogo, e `ach_synced_at` é o que segura o cache.
--
-- ⚠️ E conquista NÃO É CAMPANHA. `ach_unlocked/ach_total` responde "quantas
-- conquistas", nunca "quanto da história". Nenhuma plataforma — Steam, Xbox,
-- PlayStation ou Nintendo — entrega progresso de campanha, e é proibido
-- apresentar um como o outro na tela.
CREATE TABLE IF NOT EXISTS public.tb_user_game (
  id_user            UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_game            UUID NOT NULL REFERENCES public.tb_game(id_game) ON DELETE CASCADE,
  provider           VARCHAR(24) NOT NULL,
  playtime_minutes   INTEGER NOT NULL DEFAULT 0,
  playtime_2w_minutes INTEGER NOT NULL DEFAULT 0,
  last_played_at     TIMESTAMPTZ NULL,
  ach_unlocked       INTEGER NULL,
  ach_total          INTEGER NULL,
  ach_synced_at      TIMESTAMPTZ NULL,
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, id_game, provider),
  CONSTRAINT chk_user_game_playtime CHECK (playtime_minutes >= 0),
  CONSTRAINT chk_user_game_ach CHECK (
    (ach_unlocked IS NULL AND ach_total IS NULL) OR
    (ach_unlocked IS NOT NULL AND ach_total IS NOT NULL
     AND ach_unlocked >= 0 AND ach_total >= 0 AND ach_unlocked <= ach_total)
  )
);

-- A estante ordenada por horas (a primeira tela) e o "quem mais tem este jogo"
-- (a comparação). Dois acessos, dois índices.
CREATE INDEX IF NOT EXISTS ix_user_game_user_playtime
  ON public.tb_user_game (id_user, playtime_minutes DESC);

CREATE INDEX IF NOT EXISTS ix_user_game_game
  ON public.tb_user_game (id_game);

-- ─── 5. Kill-switch ─────────────────────────────────────────────────────────
-- Flag SEPARADA da `games`: desligar a conexão com a Steam não pode derrubar a
-- comunidade de games junto — são a mesma tela, mas não são o mesmo risco.
--
-- ⚠️ A flag NÃO decide se a Steam aparece: quem decide é a ENV
-- `STEAM_WEB_API_KEY`. É a regra que a mig 214 deixou escrita — flag ligada sem
-- credencial trava a fila em silêncio, e aqui produziria um botão "Conectar"
-- que só falha depois do clique, já fora do nosso site.
INSERT INTO public.tb_feature_flag (flag_key, label, description, is_enabled)
VALUES
  ('games_conexao', 'Perfil gamer: conectar plataforma',
   'Conectar a conta da Steam para trazer biblioteca, horas e conquistas automaticamente, e comparar progresso com outras pessoas. Desligar esconde a conexão e a estante; a comunidade de games continua funcionando. A Steam só aparece se STEAM_WEB_API_KEY estiver configurada.',
   TRUE)
ON CONFLICT (flag_key) DO NOTHING;
