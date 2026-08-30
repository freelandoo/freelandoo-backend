-- =============================================================================
-- Migration 209: Recado (post SÓ-TEXTO) como terceiro feed_kind do portfólio
-- =============================================================================
-- Decisão do Alex (2026-08-29): "toda a plataforma precisa ter opção de postar
-- somente textos" e "todos os textos serão chamados de recados".
--
-- O recado é um POST DE VERDADE: linha em tb_profile_portfolio_item com
--   feed_kind = 'recado'  e  ZERO mídia.
-- Por ser item de portfólio, ele herda de graça tudo o que já existe para posts:
-- /feed global, curtidas, comentários, salvos, denúncia, XP, engajamento, link
-- com comunidade (tb_community_feed_item) e com academia (tb_academy_feed_item).
--
-- ATENÇÃO — por que um kind explícito e não "item sem mídia":
-- o feed hoje exige >= 1 mídia ativa (PortfolioFeedStorage). Essa exigência é o
-- que segura item órfão de upload que falhou no meio. Se relaxássemos o gate
-- para "qualquer item sem mídia", todo upload interrompido viraria post vazio no
-- feed. O kind explícito separa "é texto de propósito" de "ficou sem mídia".
--
-- NÃO confundir com o recado da comunidade (mig 162, tb_community_feed_item
-- kind='recado'), que é nota exclusiva do mural do grupo e continua existindo.
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

-- A mig 053 declara o mesmo CHECK; como as migrations rodam em ordem a cada
-- boot, esta re-declaração (209 > 053) é a que vale no fim.
ALTER TABLE public.tb_profile_portfolio_item
  DROP CONSTRAINT IF EXISTS tb_profile_portfolio_item_feed_kind_chk;

ALTER TABLE public.tb_profile_portfolio_item
  ADD CONSTRAINT tb_profile_portfolio_item_feed_kind_chk
  CHECK (feed_kind IN ('feed','bees','recado'));

-- Recado exige texto: sem description não há o que mostrar (o card é só o texto).
-- CHECK só sobre a linha de recado — posts/bees seguem podendo ter description
-- nula. NOT VALID não é usado de propósito: não existe linha 'recado' antes
-- desta migration, então a validação imediata custa uma varredura barata.
ALTER TABLE public.tb_profile_portfolio_item
  DROP CONSTRAINT IF EXISTS chk_portfolio_item_recado_body;

ALTER TABLE public.tb_profile_portfolio_item
  ADD CONSTRAINT chk_portfolio_item_recado_body CHECK (
    feed_kind <> 'recado'
    OR (description IS NOT NULL AND char_length(btrim(description)) > 0)
  );

-- Listagem cronológica de recados (espelha idx_portfolio_item_feed_kind_recent,
-- que é parcial em feed_kind='feed' e por isso não cobre recado).
CREATE INDEX IF NOT EXISTS idx_portfolio_item_recado_recent
  ON public.tb_profile_portfolio_item (published_at DESC, id_portfolio_item DESC)
  WHERE status = 'published' AND is_active = TRUE AND feed_kind = 'recado';
