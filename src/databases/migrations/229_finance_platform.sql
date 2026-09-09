-- =============================================================================
-- Migration 229: a PLATAFORMA FINANCEIRO (uma só, da plataforma inteira)
-- =============================================================================
-- Pedido do Alex (2026-09-08): a raiz da Carteira "vai virar uma comunidade
-- financeira (...) tudo que todo mundo postar que for financeiro vai entrar aí
-- (...) todos os usuários vão ter acesso quando entrar ali na carteira", e,
-- perguntado se era comunidade ou mural: "é estilo o games lá (...) não precisa
-- ninguém entrar, vira uma plataforma independente, com contagem própria de
-- pontos, ranking, igualmente o games mas para o mundo financeiro".
--
-- ─── É UMA COMUNIDADE, E NÃO UMA TABELA NOVA DE POSTS ───────────────────────
--
-- A pergunta "onde ficam os posts financeiros" já tem resposta na plataforma:
-- `tb_community_feed_item` (mig 160), que é o que liga um post de portfólio ao
-- feed de uma comunidade. Reusando-a, o Financeiro herda de graça o feed
-- paginado, o composer, curtida, comentário, salvos, denúncia, XP e a escolha
-- de destino (feed geral × só aqui). Uma tabela própria de "post financeiro"
-- seria uma segunda máquina para a mesma coisa, e o dia em que o card do feed
-- ganhasse um campo, ele apareceria numa tela e não na outra.
--
-- ─── ⚠️ MAS É UMA SÓ, E ISSO A SEPARA DE TODAS AS OUTRAS ────────────────────
--
-- Games, pet e carro são UMA POR PESSOA; comum, condomínio e bairro são muitas.
-- O Financeiro é UM para o site inteiro: todo mundo lê e publica no MESMO
-- espaço. A garantia é do BANCO, não do código — índice único sobre uma
-- expressão constante (`(TRUE)`) filtrando a modalidade: com ele, uma segunda
-- linha `finance` é recusada pelo Postgres. Sem isso, uma corrida entre dois
-- primeiros acessos criaria dois "Financeiro" e a plataforma passaria a ter
-- dois murais, cada um com metade dos posts — e ninguém perceberia por semanas.
--
-- ─── QUEM É O DONO ──────────────────────────────────────────────────────────
--
-- `tb_profile.id_user` é NOT NULL, então a linha precisa de um. Fica o admin
-- mais antigo, e isso é ESCRITURAÇÃO, não posse: o Financeiro não tem líder no
-- sentido das outras comunidades — ninguém entra, ninguém é promovido, e a
-- plataforma não expõe as portas de edição dele. O dia em que a titularidade
-- precisar mudar, é um UPDATE de uma linha.
--
-- Sem admin cadastrado (banco virgem de teste), o seed não roda e a linha nasce
-- no primeiro acesso — `FinanceStorage.getOrCreatePlatform` aplica a MESMA
-- regra, e é o índice único acima que faz as duas portas convergirem para uma
-- linha só.
--
-- ─── NINGUÉM ENTRA ──────────────────────────────────────────────────────────
--
-- Não há membresia: não se cria linha em `tb_community_member` para o
-- Financeiro. Quem decide isso é o código (`CommunityService.linkFeedItem` e a
-- política de exposição), e a razão de não haver membro é a mesma da plataforma
-- de games — "entrar" numa coisa que já é de todo mundo é uma porta pintada.
-- Consequência aceita: o Financeiro fica FORA do XP e do ranking de
-- comunidades, que contam membros, e fora dos tetos de criar/participar.
-- =============================================================================

-- ─── 1) A modalidade `finance` passa a existir ──────────────────────────────
-- São DUAS constraints, e é preciso relaxar as duas: `chk_profile_community_kind`
-- (a lista de modalidades, migs 196/204/210) e `chk_profile_clan_taxonomy` (o
-- que cada modalidade exige de enxame/categoria, migs 016/204/210/219). Mexer
-- só na segunda deixa o INSERT sendo recusado pela primeira — foi assim que a
-- primeira versão desta migration falhou no teste.
--
-- Re-declaradas como SUPERSET: todos os valores antigos continuam válidos
-- palavra por palavra.
ALTER TABLE public.tb_profile DROP CONSTRAINT IF EXISTS chk_profile_community_kind;
ALTER TABLE public.tb_profile ADD CONSTRAINT chk_profile_community_kind
  CHECK (community_kind IN
    ('common', 'academy', 'condo', 'neighborhood', 'pet', 'car', 'games', 'finance'));

-- Como as outras modalidades de assunto, o Financeiro NÃO tem enxame nem
-- categoria — gravar um só para agradar a constraint seria a categoria
-- fantasma que a mig 200 teve de desfazer.
ALTER TABLE public.tb_profile DROP CONSTRAINT IF EXISTS chk_profile_clan_taxonomy;
ALTER TABLE public.tb_profile ADD CONSTRAINT chk_profile_clan_taxonomy CHECK (
  ( is_clan = FALSE AND is_community = FALSE AND id_category IS NOT NULL ) OR
  ( is_clan = TRUE  AND id_machine  IS NOT NULL AND id_category IS NULL ) OR
  ( is_community = TRUE AND id_machine IS NOT NULL AND id_category IS NULL ) OR
  ( is_community = TRUE
    AND community_kind IN ('condo', 'neighborhood', 'pet', 'car', 'games', 'common', 'finance')
    AND id_category IS NULL )
);

-- ─── 2) UMA e só uma ────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS ux_profile_finance_singleton
  ON public.tb_profile ((TRUE))
  WHERE community_kind = 'finance' AND deleted_at IS NULL;

-- ─── 3) Seed ────────────────────────────────────────────────────────────────
-- Idempotente pelo índice único acima: a segunda aplicação tenta inserir, bate
-- no `ux_profile_finance_singleton` e o ON CONFLICT a transforma em no-op. Não
-- duplica nem troca o dono.
INSERT INTO public.tb_profile (
  id_user, sub_profile_slug, display_name, bio,
  is_community, community_kind, community_privacy,
  is_clan, is_visible, is_active, id_category, id_machine
)
SELECT u.id_user,
       'financeiro',
       'Financeiro',
       'O mundo financeiro da Freelandoo. Todo mundo lê, todo mundo publica.',
       TRUE, 'finance', 'public',
       FALSE, TRUE, TRUE, NULL, NULL
  FROM public.tb_user u
 WHERE u.is_admin = TRUE
 ORDER BY u.created_at
 LIMIT 1
ON CONFLICT DO NOTHING;

COMMENT ON INDEX public.ux_profile_finance_singleton IS
  'Garante que existe NO MÁXIMO UMA plataforma Financeiro (mig 229). Índice sobre expressão constante: a segunda linha é recusada pelo banco.';
