-- =============================================================================
-- Migration 204: Bairro como modalidade de comunidade
-- Subsistema 4 do desenho macro de comunidades territoriais
-- (docs/superpowers/specs/2026-08-09-comunidades-territoriais-design.md §4/§14).
--
-- É a primeira modalidade a usar o núcleo inteiro: território (mig 202) para
-- saber ONDE, vínculo de morador (mig 203) para saber QUEM. O condomínio só
-- migra para esse núcleo no subsistema 5 — de propósito: se algo der errado
-- aqui, NENHUM condomínio existente foi tocado.
--
-- Idempotente.
-- =============================================================================

-- ─── 1. A modalidade ────────────────────────────────────────────────────────
ALTER TABLE public.tb_profile DROP CONSTRAINT IF EXISTS chk_profile_community_kind;
ALTER TABLE public.tb_profile ADD CONSTRAINT chk_profile_community_kind
  CHECK (community_kind IN ('common', 'academy', 'condo', 'neighborhood'));

-- O bairro que esta comunidade representa. NULL em toda comunidade não-bairro.
ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS id_territory BIGINT NULL
    REFERENCES public.tb_territory(id_territory) ON DELETE RESTRICT;

-- §4.3: UMA comunidade oficial por bairro. É índice, não código — dois
-- fundadores simultâneos viram violação de constraint tratada, e não duas
-- comunidades do mesmo bairro disputando quem é a verdadeira.
CREATE UNIQUE INDEX IF NOT EXISTS ux_profile_neighborhood_territory
  ON public.tb_profile (id_territory)
  WHERE community_kind = 'neighborhood' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_profile_territory
  ON public.tb_profile (id_territory)
  WHERE id_territory IS NOT NULL AND deleted_at IS NULL;

-- ─── 2. Taxonomia: o bairro não tem enxame (resolve C5) ─────────────────────
-- O CHECK da mig 154 obriga TODA comunidade a ter id_machine. Bairro não tem
-- enxame — "Bela Vista" não é uma categoria profissional. Hoje até o CONDOMÍNIO
-- carrega um enxame só para satisfazer este CHECK, que é exatamente a patologia
-- da "categoria fantasma" que a mig 200 resolveu no perfil-conta: um dado falso
-- gravado para agradar uma constraint, e que depois vaza para vitrine e busca.
--
-- Re-declarado como SUPERSET: as três alternativas antigas continuam válidas
-- palavra por palavra, e as modalidades territoriais ganham uma quarta em que
-- id_machine PODE ser NULL. Nenhuma linha existente passa a violar nada.
ALTER TABLE public.tb_profile DROP CONSTRAINT IF EXISTS chk_profile_clan_taxonomy;
ALTER TABLE public.tb_profile ADD CONSTRAINT chk_profile_clan_taxonomy CHECK (
  ( is_clan = FALSE AND is_community = FALSE AND id_category IS NOT NULL ) OR
  ( is_clan = TRUE  AND id_machine  IS NOT NULL AND id_category IS NULL ) OR
  ( is_community = TRUE AND id_machine IS NOT NULL AND id_category IS NULL ) OR
  ( is_community = TRUE AND community_kind IN ('condo', 'neighborhood')
    AND id_category IS NULL )
);

-- ─── 3. Kill-switch ─────────────────────────────────────────────────────────
-- Nasce LIGADA, como a `condominio`: o Painel de Controle serve para DESLIGAR
-- se o lançamento precisar ser segurado, não para lembrar de ligar.
INSERT INTO public.tb_feature_flag (flag_key, label, description, is_enabled)
VALUES (
  'bairro',
  'Comunidades de bairro',
  'Comunidade territorial de bairro: descoberta por cidade e bairro, entrada só para quem declarou residência e foi reconhecido pelos vizinhos. Desligar esconde a criação e a vitrine de bairros; os vínculos de residência já criados continuam intactos.',
  TRUE
)
ON CONFLICT (flag_key) DO NOTHING;
