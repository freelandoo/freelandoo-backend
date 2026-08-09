-- =============================================================================
-- Migration 202: Território, endereço e unidade — a árvore da residência
-- Subsistema 2 do desenho macro de comunidades territoriais
-- (docs/superpowers/specs/2026-08-09-comunidades-territoriais-design.md §4).
--
-- A residência é uma ÁRVORE (D11):
--     território (UF, município, bairro)  →  endereço (CEP, número)  →  unidade
--
-- Vale para bairro E condomínio. Casa = endereço com uma unidade só; prédio =
-- endereço com N unidades. Isso é o que unifica as duas modalidades: um
-- condomínio é um endereço que ganhou blocos, avisos e enquetes por cima.
--
-- O bairro NUNCA é digitado (D3'): ele sai do CEP via ViaCEP, então o conjunto
-- de nomes é fechado (strings dos Correios) e a de-duplicação vira curadoria
-- pontual do admin, não um problema aberto de entrada de usuário.
--
-- Esta migration só CRIA estrutura. Nada passa a depender dela ainda — os
-- vínculos de morador vêm no subsistema 3 e o bairro no 4. A absorção da
-- tb_condo_unit por tb_residence_unit é o subsistema 5.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

-- ─── 0. Normalizador de token ───────────────────────────────────────────────
-- fl_norm_city (mig 121) já normaliza nome de cidade/bairro (lower + sem acento).
-- Aqui entra o irmão para NÚMERO e COMPLEMENTO: além do que aquele faz, remove
-- espaços, pontos e hífens, para que "Apto 45", "apto45" e "APTO-45" caiam na
-- mesma unidade em vez de virarem três.
CREATE OR REPLACE FUNCTION fl_norm_token(t TEXT) RETURNS TEXT AS $$
  SELECT regexp_replace(fl_norm_city(coalesce(t, '')), '[^a-z0-9]', '', 'g');
$$ LANGUAGE sql IMMUTABLE;

-- ─── 1. Território (o bairro reconhecido) ───────────────────────────────────
-- bairro_label/municipio_label guardam a grafia de EXIBIÇÃO (como os Correios
-- devolveram); as colunas _norm são a identidade. status='merged' + merged_into
-- permitem ao admin fundir duplicatas sem perder o histórico de quem apontava
-- para a linha antiga.
CREATE TABLE IF NOT EXISTS public.tb_territory (
  id_territory    BIGSERIAL    PRIMARY KEY,
  uf              VARCHAR(2)   NOT NULL,
  municipio_norm  VARCHAR(160) NOT NULL,
  municipio_label VARCHAR(160) NOT NULL,
  bairro_norm     VARCHAR(160) NOT NULL,
  bairro_label    VARCHAR(160) NOT NULL,
  id_region       INT          NULL REFERENCES public.tb_region(id_region) ON DELETE SET NULL,
  -- Cidade com CEP único não devolve bairro: o território nasce abrangente da
  -- cidade inteira em vez de o cadastro travar (§6.4 do desenho).
  is_city_wide    BOOLEAN      NOT NULL DEFAULT FALSE,
  status          VARCHAR(10)  NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'merged')),
  merged_into     BIGINT       NULL REFERENCES public.tb_territory(id_territory) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- A identidade do território. É este índice que garante "no máximo uma
-- comunidade oficial por bairro" quando o subsistema 4 ligar o perfil aqui.
CREATE UNIQUE INDEX IF NOT EXISTS ux_territory_identity
  ON public.tb_territory (uf, municipio_norm, bairro_norm);

CREATE INDEX IF NOT EXISTS idx_territory_city
  ON public.tb_territory (uf, municipio_norm)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_territory_region
  ON public.tb_territory (id_region)
  WHERE id_region IS NOT NULL;

-- Território fundido tem que apontar para outro; ativo não aponta para nada.
ALTER TABLE public.tb_territory DROP CONSTRAINT IF EXISTS chk_territory_merge;
ALTER TABLE public.tb_territory ADD CONSTRAINT chk_territory_merge CHECK (
  (status = 'active' AND merged_into IS NULL) OR
  (status = 'merged' AND merged_into IS NOT NULL)
);

-- ─── 2. Endereço físico (CEP + número) ──────────────────────────────────────
-- Guardamos CEP, número e nada mais (D4): o logradouro é derivável do CEP, e
-- não guardá-lo reduz o que vaza num incidente. id_condo_profile liga o
-- endereço ao perfil-condomínio quando ele existe — UNIQUE parcial garante um
-- condomínio por endereço.
CREATE TABLE IF NOT EXISTS public.tb_address (
  id_address       BIGSERIAL    PRIMARY KEY,
  id_territory     BIGINT       NOT NULL REFERENCES public.tb_territory(id_territory) ON DELETE RESTRICT,
  cep              CHAR(8)      NOT NULL,
  numero           VARCHAR(20)  NOT NULL,
  numero_norm      VARCHAR(20)  NOT NULL,
  id_condo_profile UUID         NULL REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tb_address DROP CONSTRAINT IF EXISTS chk_address_cep;
ALTER TABLE public.tb_address ADD CONSTRAINT chk_address_cep
  CHECK (cep ~ '^[0-9]{8}$');

CREATE UNIQUE INDEX IF NOT EXISTS ux_address_identity
  ON public.tb_address (cep, numero_norm);

CREATE INDEX IF NOT EXISTS idx_address_territory
  ON public.tb_address (id_territory);

-- Um condomínio por endereço.
CREATE UNIQUE INDEX IF NOT EXISTS ux_address_condo
  ON public.tb_address (id_condo_profile)
  WHERE id_condo_profile IS NOT NULL;

-- ─── 3. Unidade (o complemento) ─────────────────────────────────────────────
-- Casa = uma unidade com label NULL. Apartamento = uma unidade por complemento.
-- `source` distingue a unidade GERADA pelo gestor do condomínio (D10: torres ×
-- andares × apartamentos) da criada sob demanda por um morador de bairro (D12)
-- — e é o que permite ao endereço registrado depois como condomínio ADOTAR as
-- unidades que já existiam.
CREATE TABLE IF NOT EXISTS public.tb_residence_unit (
  id_unit     BIGSERIAL    PRIMARY KEY,
  id_address  BIGINT       NOT NULL REFERENCES public.tb_address(id_address) ON DELETE CASCADE,
  -- Bloco/torre. Reusa a tabela do condomínio: o conceito é o mesmo, e a
  -- absorção da tb_condo_unit (subsistema 5) precisa dele preservado.
  id_block    BIGINT       NULL REFERENCES public.tb_condo_block(id_block) ON DELETE SET NULL,
  label       VARCHAR(40)  NULL,
  label_norm  VARCHAR(40)  NOT NULL DEFAULT '',
  source      VARCHAR(12)  NOT NULL DEFAULT 'claimed'
                CHECK (source IN ('claimed', 'generated')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Uma unidade por (endereço, bloco, complemento normalizado). COALESCE precisa
-- de parênteses próprios em definição de índice (armadilha paga na mig 196).
CREATE UNIQUE INDEX IF NOT EXISTS ux_residence_unit_identity
  ON public.tb_residence_unit (id_address, (COALESCE(id_block, 0)), label_norm);

CREATE INDEX IF NOT EXISTS idx_residence_unit_address
  ON public.tb_residence_unit (id_address);

CREATE INDEX IF NOT EXISTS idx_residence_unit_block
  ON public.tb_residence_unit (id_block)
  WHERE id_block IS NOT NULL;

-- ─── 4. Cache do ViaCEP ─────────────────────────────────────────────────────
-- O ViaCEP é serviço público sem SLA e está no caminho crítico da entrada. O
-- cache serve para (a) não repetir chamada e (b) continuar resolvendo endereço
-- quando ele estiver fora do ar. `not_found` marca CEP que o ViaCEP negou, para
-- não ficarmos batendo nele a cada tentativa.
CREATE TABLE IF NOT EXISTS public.tb_cep_cache (
  cep        CHAR(8)      PRIMARY KEY,
  logradouro VARCHAR(160) NULL,
  bairro     VARCHAR(160) NULL,
  localidade VARCHAR(160) NULL,
  uf         VARCHAR(2)   NULL,
  not_found  BOOLEAN      NOT NULL DEFAULT FALSE,
  fetched_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tb_cep_cache DROP CONSTRAINT IF EXISTS chk_cep_cache_cep;
ALTER TABLE public.tb_cep_cache ADD CONSTRAINT chk_cep_cache_cep
  CHECK (cep ~ '^[0-9]{8}$');

CREATE INDEX IF NOT EXISTS idx_cep_cache_stale
  ON public.tb_cep_cache (fetched_at);
