-- =============================================================================
-- Migration 241: SITE FEITO PELA FREELANDOO — o site pronto, e a brecha trancada
-- =============================================================================
-- Decisão do Alex (2026-09-12): além do CONSTRUTOR (que é de todo mundo),
-- existe o SITE PRONTO — desenhado por nós, hospedado aqui, e que o cliente
-- NÃO edita. É um produto: "peça um site para a Freelandoo".
--
-- ─── DUAS COLUNAS, E ELAS RESPONDEM PERGUNTAS DIFERENTES ────────────────────
--
--   `template`             → QUEM DESENHA (NULL = o canvas de seções; um slug
--                            = um tema autoral registrado no front)
--   `managed_by_platform`  → QUEM GRAVA   (FALSE = o líder; TRUE = só nós)
--
-- Fundir as duas numa só pareceria economia e custaria uma migration no dia em
-- que um site do construtor precisar ser travado (você monta e entrega), ou em
-- que um tema ganhar edição de dados pelo cliente. São eixos independentes.
--
-- ─── ⚠️ POR QUE `template` É COLUNA, E NUNCA CAMPO DO DOCUMENTO ─────────────
--
-- O documento (`sections`/`pages`/`theme`) é gravado pelo AUTOSAVE DO LÍDER,
-- que é a porta de escrita dele. Hoje `normalizeConfig` descarta chave
-- desconhecida, então `template` no payload não vai a lugar nenhum — e é isso
-- que mantém a brecha fechada.
--
-- A armadilha é alguém "completar o normalizador" um dia, declarando
-- `template` junto dos outros campos para deixar o documento coerente: no
-- mesmo gesto, qualquer líder passaria a poder apontar o próprio site para um
-- tema nosso, pelo autosave, sem uma linha de código nova. Por isso a coluna
-- fica FORA do documento e FORA do `upsert` — exatamente como `is_published`,
-- pelo mesmo motivo (salvar não pode publicar; salvar não pode trocar de tema).
--
-- Quem grava estas colunas é UMA rota de admin da plataforma.
--
-- ─── SEM CHECK NA LISTA DE TEMAS, DE PROPÓSITO ─────────────────────────────
--
-- Um CHECK aqui obrigaria uma migration por tema novo, e o tema é código do
-- front (o componente que desenha). Quem valida é `utils/siteTemplates.js`, a
-- fonte única — mesma disciplina de `siteEvents.js` (mig 235) e dos kinds de
-- seção, que também não têm CHECK porque vivem num JSONB.
--
-- ─── `grace_until`: O SITE NÃO SOME NO DIA EM QUE O CARTÃO FALHA ───────────
--
-- Decisão do Alex: acabando o plano, o site sai do ar DEPOIS DE UM PRAZO (30
-- dias, `MANAGED_SITE_GRACE_DAYS`). A data-limite é gravada quando a assinatura
-- termina e LIMPA quando ela volta.
--
-- ⚠️ NULL não significa "sem prazo": significa "o relógio não está correndo".
-- Site no ar com plano ativo tem `grace_until` NULL, e é a ausência da data —
-- não uma data no futuro — que diz ao sweeper para não olhar para ele.
--
-- Vale SÓ para o site gerenciado. O site do construtor continua como está hoje
-- (publicado, ele fica no ar quando o plano acaba — regra do PlanService: se
-- perde a porta, não o que já é seu). Aqui o site É o produto: hospedar de
-- graça quem parou de pagar seria entregar o produto de graça.
--
-- ─── O PLANO ───────────────────────────────────────────────────────────────
--
-- ⚠️ É UM PLANO SUPERIOR, NÃO UM PLANO PARALELO, e isso não é preferência:
-- `ux_user_plan_active` (mig 225) é único por pessoa entre as assinaturas
-- vivas. Duas assinaturas simultâneas não cabem no modelo — e a própria 225
-- explica o porquê ("qual plano vale" viraria pergunta sem resposta, e o
-- gateway cobraria as duas). Então o plano do site CARREGA as chaves do Plano
-- Negócio e acrescenta a sua: assinar é TROCAR de plano, coisa que o
-- PlanService já sabe fazer (encerra uma, abre outra).
--
-- É também o que torna verdade o "exige o Negócio" sem checagem nenhuma: não
-- existe o estado "tem site pronto e não tem Negócio".
--
-- ⚠️ AS CHAVES SÃO COPIADAS DO PLANO NEGÓCIO no momento do seed, em vez de
-- digitadas — digitadas, nasceriam desatualizadas se o Negócio mudasse entre
-- escrever e rodar. Mas CÓPIA NÃO É VÍNCULO: chave nova do Negócio daqui para
-- frente entra NOS DOIS planos, e o lugar de lembrar disso é
-- `src/utils/businessPlan.js`.
--
-- ⚠️ `managed_site` NÃO ENTRA NA LOJA DE FUNÇÕES (sem linha em
-- `tb_function_product`). Lá `is_for_sale = FALSE` significa GRÁTIS PARA TODO
-- MUNDO — é o que a mig 225 documenta e o que já transformou Carteira,
-- Academia e Serviços em nativas. A função nasceria liberada para a base
-- inteira, que é o oposto exato de uma brecha só nossa.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

-- ─── 1. As colunas do site ──────────────────────────────────────────────────

ALTER TABLE public.tb_community_site
  ADD COLUMN IF NOT EXISTS template VARCHAR(48) NULL;

ALTER TABLE public.tb_community_site
  ADD COLUMN IF NOT EXISTS template_data JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.tb_community_site
  ADD COLUMN IF NOT EXISTS managed_by_platform BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.tb_community_site
  ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.tb_community_site.template IS
  'NULL = construtor de secoes. Slug = tema autoral (utils/siteTemplates.js). Escrita SO por rota de admin - nunca pelo autosave do lider.';
COMMENT ON COLUMN public.tb_community_site.template_data IS
  'Dados do tema (negocio, cidades, servicos). NAO passa por normalizeConfig: la chave desconhecida e descartada e isto sumiria em silencio.';
COMMENT ON COLUMN public.tb_community_site.managed_by_platform IS
  'TRUE = o cliente nao edita. save/setPublished recusam; as tres portas do construtor somem do front.';
COMMENT ON COLUMN public.tb_community_site.grace_until IS
  'Data-limite da carencia depois que o plano termina. NULL = relogio parado (plano ativo). So vale para site gerenciado.';

-- Índice parcial: o sweeper da carência procura POUCAS linhas numa tabela de
-- muitas, e só as que têm o relógio correndo. Parcial pelo mesmo motivo do
-- vínculo de morador (mig 203) e da varredura de WhatsApp ocioso (mig 224).
CREATE INDEX IF NOT EXISTS ix_community_site_grace
  ON public.tb_community_site (grace_until)
  WHERE managed_by_platform = TRUE AND grace_until IS NOT NULL;

-- ─── 2. O plano ─────────────────────────────────────────────────────────────

INSERT INTO public.tb_plan (slug, name, tagline, description, price_cents, sort_order)
VALUES (
  'site-freelandoo',
  'Site Freelandoo',
  'A gente desenha, monta e hospeda o site do seu negócio.',
  'Você pede, a Freelandoo faz. Um site próprio desenhado sob medida para o seu negócio, com endereço na internet, hospedagem, agendamento online e o seu WhatsApp — e o painel de indicadores mostrando quantas pessoas visitaram e quantas clicaram. Inclui tudo do Plano Negócio.',
  9900,
  20
)
ON CONFLICT (slug) DO NOTHING;

-- As chaves do Plano Negócio, copiadas (ver o cabeçalho: cópia, não vínculo).
INSERT INTO public.tb_plan_feature (id_plan, feature_key)
SELECT novo.id_plan, f.feature_key
  FROM public.tb_plan novo
  JOIN public.tb_plan negocio ON negocio.slug = 'profissional'
  JOIN public.tb_plan_feature f ON f.id_plan = negocio.id_plan
 WHERE novo.slug = 'site-freelandoo'
ON CONFLICT DO NOTHING;

-- E a que só ele tem.
INSERT INTO public.tb_plan_feature (id_plan, feature_key)
SELECT p.id_plan, 'managed_site'
  FROM public.tb_plan p
 WHERE p.slug = 'site-freelandoo'
ON CONFLICT DO NOTHING;
