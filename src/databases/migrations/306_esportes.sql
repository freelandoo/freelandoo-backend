-- 306 — A plataforma Fitness vira ESPORTES.
--
-- Pedido do Alex (2026-10-26): "essa comunidade agora vai se chamar esportes",
-- com uma lista de esportes escolhida no primeiro acesso, a aba "Meu esporte"
-- (só o esporte da pessoa) ao lado do feed geral, e o esporte escolhido em
-- cada post.
--
-- O `community_kind` CONTINUA 'fitness': ele mora em quatro CHECKs (mig 276),
-- no índice singleton e no PLATFORM_KINDS, e trocá-lo não muda nada para quem
-- usa — muda só o nome que aparece, que é o que se pede.
--
-- A lista de esportes vive em src/utils/sports.js (fonte única) e não num
-- CHECK: esporte novo é uma linha de código, não uma migration.

-- 1. O esporte de cada pessoa (um só — decisão do Alex).
CREATE TABLE IF NOT EXISTS public.tb_user_sport (
  id_user     UUID         PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  sport       VARCHAR(24)  NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2. O esporte de cada post/recado da plataforma. NULL = publicado antes da
--    306 (ou sem escolha): aparece no Geral, não em nenhum "Meu esporte".
ALTER TABLE public.tb_community_feed_item
  ADD COLUMN IF NOT EXISTS sport VARCHAR(24) NULL;

CREATE INDEX IF NOT EXISTS ix_community_feed_item_sport
  ON public.tb_community_feed_item (id_community_profile, sport)
  WHERE sport IS NOT NULL;

-- 3. O nome. ⚠️ TEM QUE BATER com PLATFORM_SEED em PlatformStorage.js.
UPDATE public.tb_profile
   SET display_name = 'Esportes',
       bio = 'A plataforma de esportes da Freelandoo. Todo mundo lê, todo mundo publica.'
 WHERE community_kind = 'fitness' AND deleted_at IS NULL;
