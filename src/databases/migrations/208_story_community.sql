-- =============================================================================
-- Migration 208: O bee publicado DENTRO de uma comunidade pertence a ela
--
-- O botão "+" do mural (casca única de comunidade) oferece Post, Curto e BEE.
-- Os dois primeiros já sabiam a que comunidade pertenciam — o item de
-- portfólio tem esse vínculo desde a mig 173. O bee não tinha: ele nasce em
-- `tb_story`, que só conhece o PERFIL de quem postou.
--
-- Sem esta coluna, apertar "Bee" no mural do condomínio publicaria um bee
-- global, que aparece na barra de bees de quem segue a pessoa e NUNCA no
-- prédio. O botão prometeria uma coisa e faria outra — e a promessa quebrada
-- seria invisível, porque o bee é publicado com sucesso.
--
-- NULL continua sendo o normal: o bee do /bees e da StoryBar não pertence a
-- comunidade nenhuma. A coluna só diz "este aqui nasceu lá dentro".
--
-- CASCADE: comunidade apagada leva junto os bees que só existiam nela — eles
-- não têm outro lugar para aparecer.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

ALTER TABLE public.tb_story
  ADD COLUMN IF NOT EXISTS id_community UUID NULL
    REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE;

-- A faixa de bees da comunidade: os vivos, mais recentes primeiro. Parcial
-- porque a esmagadora maioria dos bees NÃO é de comunidade — indexar todos
-- pagaria escrita em todo bee do site para servir uma consulta de nicho.
CREATE INDEX IF NOT EXISTS idx_story_community_live
  ON public.tb_story (id_community, created_at DESC)
  WHERE id_community IS NOT NULL AND deleted_at IS NULL;
