-- =============================================================================
-- Migration 213: slug GLOBAL do site da comunidade
-- =============================================================================
-- O site ganha endereço próprio: /c/<slug> e, mais adiante, <slug>.dominio.
--
-- POR QUE UMA COLUNA NOVA E NÃO O sub_profile_slug QUE JÁ EXISTE:
-- `tb_profile.sub_profile_slug` (mig 020) é único POR USUÁRIO, não no site
-- inteiro — dois donos diferentes podem ter "padaria" hoje, e isso é correto
-- para o que ele serve (a URL do subperfil já vem qualificada pelo @handle).
-- Um endereço como /c/padaria ou padaria.dominio não tem essa qualificação:
-- ele precisa ser único no MUNDO, senão duas comunidades disputam a mesma
-- porta. Reaproveitar a coluna antiga obrigaria a apertar a unicidade dela e
-- quebraria os slugs de subperfil já existentes.
--
-- NULL = "esta comunidade ainda não tem endereço próprio". A coluna é
-- preenchida quando o líder publica o site (ou edita o slug à mão), e o índice
-- UNIQUE é PARCIAL porque no Postgres cada NULL é distinto — então as milhares
-- de comunidades sem site convivem sem disputar nada, e a unicidade só passa a
-- valer no instante em que alguém de fato reserva um endereço.
--
-- SEM BACKFILL de propósito: gerar slug para toda comunidade existente
-- reservaria endereços bons (/c/futebol, /c/receitas) para quem talvez nunca
-- publique um site, e o primeiro que publicasse de verdade acharia tudo tomado.
-- Quem publica, reserva.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS community_site_slug VARCHAR(63) NULL;

-- 63 caracteres é o limite de UM rótulo de DNS (RFC 1035). O slug vai virar
-- subdomínio, então nascer maior que isso criaria um endereço impossível de
-- resolver — e o erro só apareceria no dia do subdomínio, não aqui.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_profile_site_slug_format'
  ) THEN
    ALTER TABLE public.tb_profile
      ADD CONSTRAINT chk_profile_site_slug_format
      CHECK (
        community_site_slug IS NULL
        OR (
          community_site_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
          AND length(community_site_slug) BETWEEN 3 AND 63
        )
      );
  END IF;
END $$;

-- Unicidade GLOBAL entre comunidades vivas. Parcial em três eixos: só quem tem
-- slug, só comunidade, só não-apagada — comunidade excluída devolve o endereço
-- para o próximo, em vez de deixá-lo reservado para sempre por um fantasma.
CREATE UNIQUE INDEX IF NOT EXISTS ux_profile_community_site_slug
  ON public.tb_profile (community_site_slug)
  WHERE community_site_slug IS NOT NULL
    AND is_community = TRUE
    AND deleted_at IS NULL;
