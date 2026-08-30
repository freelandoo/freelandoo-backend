-- =============================================================================
-- Migration 205: Condomínio absorvido pelo núcleo territorial
-- Subsistema 5 do desenho macro de comunidades territoriais
-- (docs/superpowers/specs/2026-08-09-comunidades-territoriais-design.md §14).
--
-- Este é o passo que a §13 chamou de "o único com risco real de dados", e por
-- isso ficou por último: o núcleo (migs 202-204) já rodou em produção com dados
-- novos antes de qualquer condomínio existente ser tocado.
--
-- O que muda de VERDADE aqui não é o schema, é a regra: o condomínio deixa de
-- ter unidade de TITULAR ÚNICO e passa a ter unidade com MORADORES (N:N). É o
-- conflito E1 do desenho:
--
--   antes  aprovar reivindicação -> setUnitHolder -> o morador anterior perde a
--          unidade em silêncio, sem registro, sem motivo e sem ser avisado
--   agora  a unidade tem quantos moradores tiver; entrar não expulsa ninguém.
--          Perder residência exige decisão humana explícita (§7.1)
--
-- É o que sustenta o "aceitar como família": duas pessoas no mesmo apartamento
-- é o NORMAL, não a exceção que precisa de arbitragem.
--
-- NENHUM DROP. `tb_condo_unit` sobrevive como legado com um ponteiro para a
-- unidade nova — o padrão da mig 190, que já provou funcionar. O backfill é
-- 100% OFFLINE: nenhuma chamada ao ViaCEP roda aqui (migration não faz rede;
-- o endereço do condomínio já tem bairro/cidade/UF nas colunas da mig 196).
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

-- ─── 1. Andar (D10) ─────────────────────────────────────────────────────────
-- A unidade de bairro não tem andar (casa não tem), por isso NULL é válido.
-- Subsolo/térreo existem: o piso pode ser negativo ou zero.
ALTER TABLE public.tb_residence_unit
  ADD COLUMN IF NOT EXISTS floor INT NULL;

ALTER TABLE public.tb_residence_unit DROP CONSTRAINT IF EXISTS chk_residence_unit_floor;
ALTER TABLE public.tb_residence_unit ADD CONSTRAINT chk_residence_unit_floor
  CHECK (floor IS NULL OR floor BETWEEN -20 AND 300);

-- Grade do morador: "bloco X, andar Y" precisa ser barato de listar.
CREATE INDEX IF NOT EXISTS idx_residence_unit_block_floor
  ON public.tb_residence_unit (id_block, floor)
  WHERE id_block IS NOT NULL;

-- ─── 2. A planta declarada pelo gestor (D10) ────────────────────────────────
-- O gestor declara a GRADE da torre; o gerador materializa as unidades. As
-- duas colunas ficam como o que foi DECLARADO, não como verdade: condomínio
-- real tem cobertura, loja, andar sem 13º — o gestor edita depois (§11.1), e
-- a planta real é sempre `tb_residence_unit`, nunca esta declaração.
ALTER TABLE public.tb_condo_block
  ADD COLUMN IF NOT EXISTS floors          INT NULL,
  ADD COLUMN IF NOT EXISTS units_per_floor INT NULL,
  -- Primeiro andar numerado. Prédio que começa no térreo = 0; a maioria = 1.
  ADD COLUMN IF NOT EXISTS first_floor     INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS generated_at    TIMESTAMPTZ NULL;

ALTER TABLE public.tb_condo_block DROP CONSTRAINT IF EXISTS chk_condo_block_grid;
ALTER TABLE public.tb_condo_block ADD CONSTRAINT chk_condo_block_grid CHECK (
  (floors IS NULL OR floors BETWEEN 1 AND 200) AND
  (units_per_floor IS NULL OR units_per_floor BETWEEN 1 AND 100) AND
  first_floor BETWEEN -20 AND 300
);

-- ─── 3. Ponteiro do legado ──────────────────────────────────────────────────
-- `tb_condo_unit` não é apagada: vira índice histórico do que existia antes da
-- absorção. SET NULL e não CASCADE — a linha legada sobrevive à unidade nova.
ALTER TABLE public.tb_condo_unit
  ADD COLUMN IF NOT EXISTS id_residence_unit BIGINT NULL
    REFERENCES public.tb_residence_unit(id_unit) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_condo_unit_residence
  ON public.tb_condo_unit (id_residence_unit)
  WHERE id_residence_unit IS NOT NULL;

-- ─── 4. Backfill: território dos condomínios existentes ─────────────────────
-- Sem rede: UF/cidade/bairro saem das colunas que a mig 196 já grava. Só entra
-- condomínio com CEP E número — sem os dois não existe endereço, e inventar um
-- seria pior do que deixar o gestor completar depois (o service adota o
-- endereço na primeira vez que a planta for aberta).
--
-- Condomínio sem bairro cadastrado vira território ABRANGENTE da cidade, que é
-- a mesma degradação da mig 202 para CEP único de cidade pequena (§6.4).
INSERT INTO public.tb_territory
  (uf, municipio_norm, municipio_label, bairro_norm, bairro_label,
   id_region, is_city_wide)
SELECT DISTINCT
       upper(p.estado),
       fl_norm_city(p.municipio),
       p.municipio,
       fl_norm_city(COALESCE(p.condo_neighborhood, '')),
       COALESCE(p.condo_neighborhood, ''),
       (SELECT rc.id_region
          FROM public.tb_region_city rc
         WHERE rc.uf = upper(p.estado)
           AND rc.municipio_norm = fl_norm_city(p.municipio)
         LIMIT 1),
       NULLIF(btrim(COALESCE(p.condo_neighborhood, '')), '') IS NULL
  FROM public.tb_profile p
 WHERE p.community_kind = 'condo'
   AND p.deleted_at IS NULL
   AND NULLIF(btrim(COALESCE(p.estado, '')), '') IS NOT NULL
   AND NULLIF(btrim(COALESCE(p.municipio, '')), '') IS NOT NULL
   AND length(regexp_replace(COALESCE(p.condo_cep, ''), '\D', '', 'g')) = 8
   AND NULLIF(btrim(COALESCE(p.condo_number, '')), '') IS NOT NULL
ON CONFLICT (uf, municipio_norm, bairro_norm) DO NOTHING;

-- ─── 5. Backfill: endereço do condomínio ────────────────────────────────────
INSERT INTO public.tb_address
  (id_territory, cep, numero, numero_norm, id_condo_profile)
SELECT t.id_territory,
       regexp_replace(p.condo_cep, '\D', '', 'g'),
       btrim(p.condo_number),
       fl_norm_token(btrim(p.condo_number)),
       p.id_profile
  FROM public.tb_profile p
  JOIN public.tb_territory t
    ON t.uf             = upper(p.estado)
   AND t.municipio_norm = fl_norm_city(p.municipio)
   AND t.bairro_norm    = fl_norm_city(COALESCE(p.condo_neighborhood, ''))
 WHERE p.community_kind = 'condo'
   AND p.deleted_at IS NULL
   AND length(regexp_replace(COALESCE(p.condo_cep, ''), '\D', '', 'g')) = 8
   AND NULLIF(btrim(COALESCE(p.condo_number, '')), '') IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM public.tb_address a2
          WHERE a2.id_condo_profile = p.id_profile
       )
ON CONFLICT (cep, numero_norm) DO NOTHING;

-- Adoção: o endereço pode já existir porque um morador de BAIRRO o cadastrou
-- antes (D12). É exatamente o caso que o comentário da mig 202 anteviu — o
-- endereço registrado depois como condomínio adota as unidades que já havia.
-- O NOT EXISTS respeita a ux_address_condo (um endereço por condomínio).
UPDATE public.tb_address a
   SET id_condo_profile = p.id_profile
  FROM public.tb_profile p
 WHERE a.id_condo_profile IS NULL
   AND p.community_kind = 'condo'
   AND p.deleted_at IS NULL
   AND length(regexp_replace(COALESCE(p.condo_cep, ''), '\D', '', 'g')) = 8
   AND a.cep = regexp_replace(COALESCE(p.condo_cep, ''), '\D', '', 'g')
   AND a.numero_norm = fl_norm_token(btrim(COALESCE(p.condo_number, '')))
   AND NOT EXISTS (
         SELECT 1 FROM public.tb_address a2
          WHERE a2.id_condo_profile = p.id_profile
       );

-- ─── 6. Backfill: unidades ──────────────────────────────────────────────────
-- `source='claimed'`: estas unidades nasceram de reivindicação de morador na
-- mig 196, não do gerador. A distinção importa para o gestor saber o que ele
-- declarou e o que o prédio ensinou.
INSERT INTO public.tb_residence_unit
  (id_address, id_block, label, label_norm, source)
SELECT a.id_address, cu.id_block, cu.number,
       fl_norm_token(cu.number), 'claimed'
  FROM public.tb_condo_unit cu
  JOIN public.tb_address a ON a.id_condo_profile = cu.id_condo
ON CONFLICT (id_address, (COALESCE(id_block, 0)), label_norm) DO NOTHING;

UPDATE public.tb_condo_unit cu
   SET id_residence_unit = ru.id_unit
  FROM public.tb_address a, public.tb_residence_unit ru
 WHERE a.id_condo_profile = cu.id_condo
   AND ru.id_address = a.id_address
   AND COALESCE(ru.id_block, 0) = COALESCE(cu.id_block, 0)
   AND ru.label_norm = fl_norm_token(cu.number)
   AND cu.id_residence_unit IS NULL;

-- ─── 7. Backfill: moradores ─────────────────────────────────────────────────
-- O titular de hoje vira morador RECONHECIDO — ele já passou pela aprovação do
-- síndico na mig 196; rebaixá-lo a pendente faria a migração tirar direito de
-- quem não fez nada. `recognized_by` fica NULL: ninguém reconheceu, a migração
-- herdou. O CHECK chk_residence_recognized só exige a DATA, e ela vem do
-- holder_since real (a data em que a titularidade foi de fato concedida).
INSERT INTO public.tb_residence_member
  (id_unit, id_user, status, claimed_at, recognized_at)
SELECT cu.id_residence_unit,
       cu.id_holder_user,
       'recognized',
       COALESCE(cu.holder_since, cu.created_at),
       COALESCE(cu.holder_since, cu.created_at)
  FROM public.tb_condo_unit cu
 WHERE cu.id_holder_user IS NOT NULL
   AND cu.id_residence_unit IS NOT NULL
ON CONFLICT DO NOTHING;
