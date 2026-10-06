-- 272_vaquinha_post_feed.sql
-- O QUE SE PUBLICA NA VAQUINHA VAI PARA O FEED GERAL (Alex, 2026-10-05).
--
-- Até aqui `tb_vaquinha_post` (mig 170) era "só na página da vaquinha". Agora
-- cada publicação (recado, foto, curto) também nasce como um post DE VERDADE no
-- perfil-conta do dono — item de `tb_profile_portfolio_item`, com curtida,
-- comentário, salvos e denúncia de graça — e o card do feed ganha no header o
-- botão que leva à vaquinha.
--
-- A ligação é UMA coluna aqui, e não uma tabela de vínculo como a das
-- academias (`tb_academy_feed_item`): o post da vaquinha e o item do feed
-- nascem JUNTOS, um para um, e quem precisa ir de um para o outro é o feed
-- (para achar a vaquinha) e o apagar (para tirar os dois).
--
-- SET NULL: apagar o item pelo perfil não pode apagar a publicação da página
-- da vaquinha (ela é a fonte), e vice-versa o service desativa o item.
-- Sem backfill: o que já foi publicado continua só na página, como foi feito.

ALTER TABLE public.tb_vaquinha_post
  ADD COLUMN IF NOT EXISTS id_portfolio_item UUID
    REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vaquinha_post_item
  ON public.tb_vaquinha_post (id_portfolio_item)
  WHERE id_portfolio_item IS NOT NULL;
