-- =============================================================================
-- Migration 196: Condomínio (modalidade de comunidade)
-- A comunidade ganha MODALIDADE (community_kind): 'common' | 'academy' | 'condo'.
-- O condomínio reaproveita todo o esqueleto de comunidade (tb_profile
-- is_community + tb_community_member), e acrescenta o que é dele:
--   * endereço próprio (pesquisável, mas com rua/número tratados como sensíveis)
--   * blocos, unidades (apartamentos) e vagas de garagem
--   * reivindicação de unidade/vaga com aprovação do administrador quando há
--     conflito (unidade já ocupada por outra pessoa)
--   * configuração de cota/preço de anúncios (usada na mig 198)
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

-- ─── 1. Modalidade da comunidade ────────────────────────────────────────────
-- Comunidades existentes viram 'common' pelo DEFAULT (sem backfill manual).
ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS community_kind VARCHAR(16) NOT NULL DEFAULT 'common';

ALTER TABLE public.tb_profile DROP CONSTRAINT IF EXISTS chk_profile_community_kind;
ALTER TABLE public.tb_profile ADD CONSTRAINT chk_profile_community_kind
  CHECK (community_kind IN ('common', 'academy', 'condo'));

CREATE INDEX IF NOT EXISTS idx_tb_profile_community_kind
  ON public.tb_profile (community_kind)
  WHERE is_community = TRUE AND deleted_at IS NULL;

-- ─── 2. Endereço do condomínio ──────────────────────────────────────────────
-- Cidade/UF/região continuam nas colunas que a tb_profile já tem (estado,
-- municipio, id_region). Aqui entram só os campos de rua — SENSÍVEIS: a API
-- só devolve logradouro/número/CEP para membro confirmado ou administrador.
ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS condo_street       VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS condo_number       VARCHAR(20)  NULL,
  ADD COLUMN IF NOT EXISTS condo_complement   VARCHAR(80)  NULL,
  ADD COLUMN IF NOT EXISTS condo_neighborhood VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS condo_cep          VARCHAR(9)   NULL;

-- Busca por endereço (o texto do bairro/rua entra no ILIKE da vitrine).
CREATE INDEX IF NOT EXISTS idx_tb_profile_condo_addr
  ON public.tb_profile (condo_neighborhood)
  WHERE community_kind = 'condo' AND deleted_at IS NULL;

-- ─── 3. Blocos ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_condo_block (
  id_block   BIGSERIAL   PRIMARY KEY,
  id_condo   UUID        NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  name       VARCHAR(60) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_condo_block_name
  ON public.tb_condo_block (id_condo, lower(name));

CREATE INDEX IF NOT EXISTS idx_condo_block_condo
  ON public.tb_condo_block (id_condo);

-- ─── 4. Unidades (apartamentos) ─────────────────────────────────────────────
-- id_holder_user = morador responsável ATUAL (a "ocupação"). NULL = livre.
-- A unidade nasce quando alguém a reivindica — não exigimos o admin cadastrar
-- a planta inteira antes (mas ele pode, pelo CRUD de unidades).
CREATE TABLE IF NOT EXISTS public.tb_condo_unit (
  id_unit        BIGSERIAL   PRIMARY KEY,
  id_condo       UUID        NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_block       BIGINT      NULL REFERENCES public.tb_condo_block(id_block) ON DELETE SET NULL,
  number         VARCHAR(20) NOT NULL,
  id_holder_user UUID        NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  holder_since   TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uma unidade por (condomínio, bloco, número). Bloco NULL = condomínio sem
-- blocos; COALESCE mantém o UNIQUE válido nesse caso.
-- COALESCE precisa de parênteses próprios em definição de índice.
CREATE UNIQUE INDEX IF NOT EXISTS ux_condo_unit_number
  ON public.tb_condo_unit (id_condo, (COALESCE(id_block, 0)), lower(number));

CREATE INDEX IF NOT EXISTS idx_condo_unit_holder
  ON public.tb_condo_unit (id_holder_user)
  WHERE id_holder_user IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_condo_unit_condo
  ON public.tb_condo_unit (id_condo);

-- ─── 5. Vagas de garagem ────────────────────────────────────────────────────
-- A vaga é vinculada à OCUPAÇÃO do morador (id_unit) e tem dono próprio, com
-- a mesma validação de conflito das unidades.
CREATE TABLE IF NOT EXISTS public.tb_condo_parking (
  id_spot        BIGSERIAL   PRIMARY KEY,
  id_condo       UUID        NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_unit        BIGINT      NULL REFERENCES public.tb_condo_unit(id_unit) ON DELETE SET NULL,
  code           VARCHAR(20) NOT NULL,
  id_holder_user UUID        NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  holder_since   TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_condo_parking_code
  ON public.tb_condo_parking (id_condo, lower(code));

CREATE INDEX IF NOT EXISTS idx_condo_parking_holder
  ON public.tb_condo_parking (id_holder_user)
  WHERE id_holder_user IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_condo_parking_condo
  ON public.tb_condo_parking (id_condo);

-- ─── 6. Reivindicações ──────────────────────────────────────────────────────
-- Unidade/vaga LIVRE: aprova na hora (status 'approved', decided_by NULL).
-- Unidade/vaga OCUPADA por outra pessoa: fica 'pending' até o administrador
-- da comunidade decidir (aprovar transfere a titularidade; recusar arquiva).
CREATE TABLE IF NOT EXISTS public.tb_condo_claim (
  id_claim    BIGSERIAL    PRIMARY KEY,
  id_condo    UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user     UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  target_type VARCHAR(10)  NOT NULL CHECK (target_type IN ('unit', 'parking')),
  id_unit     BIGINT       NULL REFERENCES public.tb_condo_unit(id_unit) ON DELETE CASCADE,
  id_spot     BIGINT       NULL REFERENCES public.tb_condo_parking(id_spot) ON DELETE CASCADE,
  status      VARCHAR(12)  NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
  note        VARCHAR(280) NULL,
  decided_by  UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  decided_at  TIMESTAMPTZ  NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tb_condo_claim DROP CONSTRAINT IF EXISTS chk_condo_claim_target;
ALTER TABLE public.tb_condo_claim ADD CONSTRAINT chk_condo_claim_target CHECK (
  (target_type = 'unit'    AND id_unit IS NOT NULL AND id_spot IS NULL) OR
  (target_type = 'parking' AND id_spot IS NOT NULL AND id_unit IS NULL)
);

-- No máximo 1 reivindicação pendente por (user, unidade) e (user, vaga).
CREATE UNIQUE INDEX IF NOT EXISTS ux_condo_claim_pending_unit
  ON public.tb_condo_claim (id_user, id_unit)
  WHERE status = 'pending' AND id_unit IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_condo_claim_pending_spot
  ON public.tb_condo_claim (id_user, id_spot)
  WHERE status = 'pending' AND id_spot IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_condo_claim_pending
  ON public.tb_condo_claim (id_condo, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_condo_claim_user
  ON public.tb_condo_claim (id_user, created_at DESC);

-- ─── 7. Configuração de cota/preço de anúncio ───────────────────────────────
-- Global (singleton id=1) + override opcional por condomínio (NULL = herda).
-- Consumido pela mig 198 (anúncios do mural/serviços/produtos).
CREATE TABLE IF NOT EXISTS public.condo_settings (
  id                      INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  free_service_listings   INT         NOT NULL DEFAULT 2 CHECK (free_service_listings >= 0),
  free_product_listings   INT         NOT NULL DEFAULT 2 CHECK (free_product_listings >= 0),
  extra_slot_price_cents  INT         NOT NULL DEFAULT 990 CHECK (extra_slot_price_cents >= 0),
  extra_slot_price_polens INT         NOT NULL DEFAULT 200 CHECK (extra_slot_price_polens >= 0),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by              UUID        NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);
INSERT INTO public.condo_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tb_condo_config (
  id_condo                UUID        PRIMARY KEY REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  free_service_listings   INT         NULL CHECK (free_service_listings >= 0),
  free_product_listings   INT         NULL CHECK (free_product_listings >= 0),
  extra_slot_price_cents  INT         NULL CHECK (extra_slot_price_cents >= 0),
  extra_slot_price_polens INT         NULL CHECK (extra_slot_price_polens >= 0),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 8. Feature flag (Painel de Controle) ───────────────────────────────────
INSERT INTO public.tb_feature_flag (flag_key, label, description)
VALUES (
  'condominio',
  'Condomínios',
  'Modalidade de comunidade para condomínios: blocos, unidades, vagas, avisos direcionados, anúncios internos e enquetes. Desligar esconde a criação e a busca de condomínios; os já criados continuam existindo.'
)
ON CONFLICT (flag_key) DO NOTHING;
