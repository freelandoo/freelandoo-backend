-- =============================================================================
-- Migration 233: a foto DENTRO da plataforma — herda o rosto, aceita ser trocada
-- =============================================================================
-- Pedido do Alex (2026-09-09), sobre games e, na mesma frase, sobre o
-- Financeiro: "a foto de perfil você vai puxar do perfil principal, sempre.
-- Mas, se a pessoa quiser alterar, ela altera e só altera o games. Assim
-- também precisa ser no financeiro."
--
-- ─── POR QUE ISTO NÃO CABIA EM NENHUM LUGAR QUE JÁ EXISTE ───────────────────
--
-- O rosto da PESSOA é `tb_user.avatar` (mig 215, fonte única espelhada em
-- `tb_profile.avatar_url` do perfil-conta). Gravar a foto de games ali trocaria
-- a cara da pessoa no site inteiro — que é exatamente o oposto do pedido
-- ("só altera o games").
--
-- E não dá para pendurá-la no PERFIL da plataforma: games e Financeiro são UMA
-- linha de `tb_profile` para o site todo (migs 229/232). A foto gravada lá
-- seria a mesma para todos os visitantes — a foto DA CASA, não a de quem olha.
--
-- Daí uma tabela de OVERRIDE, com uma linha por (pessoa, plataforma). Ausência
-- de linha não é "sem foto": é "usa o rosto de sempre". É essa distinção que
-- faz a herança do pedido ("puxar do perfil principal, SEMPRE") continuar
-- valendo para quem nunca trocou nada — inclusive quando a pessoa muda a foto
-- principal depois.
--
-- ⚠️ E É POR ISSO QUE APAGAR A LINHA É UMA OPERAÇÃO DE VERDADE, e não um
-- estado esquisito: "voltar a usar a minha foto" é DELETE, não gravar NULL.
-- Com NULL permitido haveria dois jeitos de dizer a mesma coisa, e a leitura
-- (`COALESCE(override, tb_user.avatar)`) teria de conhecer os dois.
--
-- ⚠️ A LISTA DE PLATAFORMAS É FECHADA e é a MESMA de `utils/gamesScore.js`
-- (PLATFORM_KINDS = games, finance). Sem o CHECK, um `kind` digitado errado
-- criaria uma foto que nenhuma tela lê e que ninguém consegue apagar pela
-- interface. Plataforma nova entra nos DOIS lugares.
--
-- SEM BACKFILL, de propósito: ninguém trocou foto de plataforma ainda (a
-- feature nasce aqui), e semear com o avatar de hoje congelaria o rosto de todo
-- mundo — quem trocasse a foto principal depois veria a plataforma continuar
-- exibindo a antiga, sem nunca ter pedido isso.

CREATE TABLE IF NOT EXISTS public.tb_user_platform_avatar (
  id_user    UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  kind       VARCHAR(20) NOT NULL,
  avatar_url TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_user_platform_avatar PRIMARY KEY (id_user, kind)
);

-- A trava da lista fechada. Recriada por nome (DROP antes de ADD) para a
-- migration continuar idempotente — o runner reexecuta o arquivo no boot.
ALTER TABLE public.tb_user_platform_avatar
  DROP CONSTRAINT IF EXISTS chk_user_platform_avatar_kind;
ALTER TABLE public.tb_user_platform_avatar
  ADD CONSTRAINT chk_user_platform_avatar_kind
  CHECK (kind IN ('games', 'finance'));

-- Uma URL vazia seria uma foto que não carrega: o front desenharia o buraco em
-- vez das iniciais, porque para ele existe override.
ALTER TABLE public.tb_user_platform_avatar
  DROP CONSTRAINT IF EXISTS chk_user_platform_avatar_url;
ALTER TABLE public.tb_user_platform_avatar
  ADD CONSTRAINT chk_user_platform_avatar_url
  CHECK (length(btrim(avatar_url)) > 0);

-- SEM índice por `kind` sozinho, de propósito: toda leitura desta tabela sabe
-- de QUEM é a foto (a PK começa por id_user), e não existe nenhuma pergunta do
-- tipo "quem trocou a foto de games?" numa tela.
