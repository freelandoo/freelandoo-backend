-- =============================================================================
-- Migration 254: PROSPECÇÃO — a base de empresas brasileiras e as listas de leads.
--
-- ─── O QUE ESTE SUBSISTEMA É (e o que ele NÃO é) ────────────────────────────
--
-- É uma BASE EMPRESARIAL ENRIQUECIDA, compartilhada por toda a plataforma: o
-- negócio do Alex procura "academias em São Bernardo", a base responde, e o
-- que foi descoberto/enriquecido fica para o próximo que procurar. NÃO é uma
-- cópia do Google Maps e NÃO faz scraping dele.
--
-- ⚠️⚠️ A DECISÃO QUE DESENHA TUDO: A DESCOBERTA É OSM, O CNPJ É ENRIQUECIMENTO.
--
-- A tentação óbvia é importar os Dados Abertos de CNPJ da Receita e pesquisar
-- neles. São **~60 milhões de estabelecimentos, ~5 GB comprimidos**, no MESMO
-- Postgres que serve o site inteiro — e o pedido do projeto diz, com todas as
-- letras, para não importar uma base gigantesca de maneira ingênua. Pior: a
-- base de CNPJ **não sabe responder "academias perto daqui"**. Ela não tem
-- coordenada, o CNAE descreve a atividade declarada (não o que a placa diz) e
-- metade do cadastro está desatualizado.
--
-- Quem sabe responder aquilo é o **OpenStreetMap**: ele tem o estabelecimento
-- FÍSICO, com nome, categoria, coordenada, telefone e site. Então:
--
--     DESCOBERTA  = OSM (Overpass), por cidade + categoria
--     ENRIQUECIMENTO = CNPJ (API pública), site oficial, redes sociais
--
-- O importador em massa de CNPJ fica **projetado e desligado**: `tb_company`
-- já tem todas as colunas dele, e o dia em que valer a pena ele preenche as
-- mesmas linhas. Nada precisa ser reinterpretado depois.
--
-- ─── POR QUE NÃO POSTGIS ────────────────────────────────────────────────────
--
-- Não existe UMA coordenada em todo o backend hoje (varredura: zero `latitude`,
-- zero `postgis`). Ligar uma extensão no Postgres de produção para estrear uma
-- feature é risco que não se paga: `CREATE EXTENSION postgis` exige superusuário
-- e o boot do runner **aborta com exit 1** quando uma migration falha — ou seja,
-- o preço de a extensão não estar disponível seria a plataforma inteira fora do
-- ar. Aqui a busca por raio é bounding box (que o índice composto resolve) mais
-- haversine na projeção, em SQL puro. Quando o volume justificar PostGIS, as
-- colunas já estão no lugar certo e a migração é aditiva.
--
-- ─── AS SEIS TABELAS, E POR QUE CADA UMA EXISTE ─────────────────────────────
--
--   tb_company            a empresa (GLOBAL, compartilhada)
--   tb_company_source     de ONDE veio cada campo  ← resolve conflito de fonte
--   tb_company_job        a fila de descoberta/enriquecimento
--   tb_lead_list          lista de prospecção DO NEGÓCIO
--   tb_lead_list_item     empresa na lista, já com os campos de CRM
--   tb_company_suppression opt-out (LGPD)
--   tb_osm_area_cache     cidade → área do OSM (evita repetir o geocoding)
--   prospeccao_settings   os botões de custo/limite, numa linha só
--
-- Idempotente (CREATE ... IF NOT EXISTS, DROP CONSTRAINT antes de ADD).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A EMPRESA
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ ELA É GLOBAL, E ISSO É A FEATURE. Uma `tb_company` por negócio que
-- prospecta faria a mesma academia ser descoberta e enriquecida N vezes, pagando
-- N vezes pelo mesmo crawl. Aqui o enriquecimento é um BEM COMUM: quem pedir
-- depois já acha pronto. O que é privado são as LISTAS (tb_lead_list).
--
-- ⚠️ `display_name` É NOT NULL E OS OUTROS DOIS NÃO. Razão social só existe
-- quando há CNPJ; nome fantasia, quando alguém o declarou. O que a tela sempre
-- precisa ter é um nome — e sem esta coluna a projeção teria um COALESCE de
-- três campos repetido em cada leitura, divergindo na primeira que esquecesse.
--
-- ⚠️ `name_norm` É A CHAVE DE MATCHING, não enfeite de busca: é por ela que
-- "Academia Corpo & Ação LTDA" e "ACADEMIA CORPO E ACAO" viram a mesma empresa.
-- Quem a produz é `utils/companyNormalize.js` — NUNCA escrever esta coluna com
-- uma normalização feita à mão no SQL.
CREATE TABLE IF NOT EXISTS public.tb_company (
  id_company          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── identidade oficial (Receita) ──────────────────────────────────────────
  cnpj                CHAR(14)      NULL,
  legal_name          TEXT          NULL,
  trade_name          TEXT          NULL,
  display_name        TEXT          NOT NULL,
  name_norm           TEXT          NOT NULL,
  description         TEXT          NULL,

  -- ── classificação ─────────────────────────────────────────────────────────
  -- `category_key` é a nossa taxonomia (lista FECHADA em utils/companyCategories),
  -- e é ela que o filtro da tela usa. `main_cnae` é o que a Receita declara —
  -- os dois convivem de propósito: o CNAE é preciso e chega tarde (só com CNPJ),
  -- a categoria é aproximada e chega na descoberta.
  category_key        VARCHAR(48)   NULL,
  main_cnae           VARCHAR(7)    NULL,
  cnae_list           JSONB         NOT NULL DEFAULT '[]'::jsonb,
  company_size        VARCHAR(24)   NULL,
  legal_nature        VARCHAR(8)    NULL,
  share_capital_cents BIGINT        NULL,
  opened_at           DATE          NULL,
  reg_status          VARCHAR(24)   NULL,
  is_headquarters     BOOLEAN       NULL,

  -- ── canais comerciais ─────────────────────────────────────────────────────
  -- ⚠️ `domain` é DERIVADO de `website` e existe separado porque ele é chave de
  -- matching (duas fontes citando `padariadoze.com.br` são a mesma empresa) e
  -- chave de supressão (LGPD: bloquear um domínio é bloquear a empresa).
  website             TEXT          NULL,
  domain              TEXT          NULL,
  email               TEXT          NULL,
  phone               VARCHAR(20)   NULL,
  whatsapp            VARCHAR(20)   NULL,
  instagram           TEXT          NULL,
  facebook            TEXT          NULL,
  linkedin            TEXT          NULL,
  tiktok              TEXT          NULL,
  youtube             TEXT          NULL,

  -- ── endereço ──────────────────────────────────────────────────────────────
  address             TEXT          NULL,
  address_number      VARCHAR(20)   NULL,
  complement          TEXT          NULL,
  neighborhood        TEXT          NULL,
  city                TEXT          NULL,
  city_norm           TEXT          NULL,
  uf                  CHAR(2)       NULL,
  zip_code            CHAR(8)       NULL,
  country             CHAR(2)       NOT NULL DEFAULT 'BR',
  -- Mesma régua de região do resto da plataforma (mig 121). Resolvida por
  -- (uf, city_norm) contra tb_region_city; fica NULL quando a cidade não está
  -- mapeada, exatamente como o cadastro de perfil já faz.
  id_region           INT           NULL REFERENCES public.tb_region(id_region) ON DELETE SET NULL,
  latitude            NUMERIC(10,7) NULL,
  longitude           NUMERIC(10,7) NULL,

  -- ── proveniência agregada ─────────────────────────────────────────────────
  -- `osm_ref` no formato 'node/123456' — é a chave de dedupe da descoberta.
  osm_ref             VARCHAR(32)   NULL,
  -- 0..100. Não é "qualidade do lead": é quanto se sabe sobre a LINHA. Quem a
  -- calcula é utils/companyConfidence.js, a partir das fontes em tb_company_source.
  confidence          SMALLINT      NOT NULL DEFAULT 0,
  -- none | queued | partial | done | failed
  enrichment_status   VARCHAR(16)   NOT NULL DEFAULT 'none',
  enriched_at         TIMESTAMPTZ   NULL,
  -- ⚠️ TRÊS CARIMBOS SEPARADOS, e não um só: o TTL de cada fonte é diferente
  -- (o site muda toda semana, o CNPJ muda uma vez por ano). Com um carimbo só,
  -- re-enriquecer para atualizar o site pagaria a chamada de CNPJ junto.
  website_checked_at  TIMESTAMPTZ   NULL,
  cnpj_checked_at     TIMESTAMPTZ   NULL,
  osm_checked_at      TIMESTAMPTZ   NULL,

  is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
  -- ⚠️ OPT-OUT NÃO APAGA A LINHA, e isso é o que faz o opt-out FUNCIONAR:
  -- apagada, a próxima descoberta recriaria a mesma empresa e ela voltaria à
  -- vitrine como se nada tivesse sido pedido. Suprimida, ela continua existindo
  -- para que o matching a reconheça e continue a ignorando.
  suppressed_at       TIMESTAMPTZ   NULL,
  suppressed_reason   TEXT          NULL,

  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ⚠️ UNIQUE PARCIAL, NÃO UNIQUE CRU. A esmagadora maioria das linhas nasce pela
-- descoberta do OSM, SEM CNPJ — um UNIQUE cru deixaria uma única linha sem CNPJ
-- existir no banco inteiro (NULL é distinto em UNIQUE no Postgres, mas o índice
-- pesaria à toa) e, o que importa de verdade, o parcial deixa o planner usar o
-- índice como "acha a empresa deste CNPJ" sem varrer os nulos.
CREATE UNIQUE INDEX IF NOT EXISTS ux_company_cnpj
  ON public.tb_company (cnpj) WHERE cnpj IS NOT NULL;

-- Dedupe da descoberta: o mesmo nó do OSM re-lido não cria segunda empresa.
CREATE UNIQUE INDEX IF NOT EXISTS ux_company_osm_ref
  ON public.tb_company (osm_ref) WHERE osm_ref IS NOT NULL;

-- O índice da BUSCA. A pergunta da tela é sempre "categoria X na cidade Y", e
-- é esta ordem de colunas que a serve: (uf, city_norm) recorta primeiro (é o
-- que mais reduz), a categoria depois.
CREATE INDEX IF NOT EXISTS ix_company_place
  ON public.tb_company (uf, city_norm, category_key)
  WHERE is_active = TRUE AND suppressed_at IS NULL;

-- Matching por domínio e por nome. Os dois entram no motor de deduplicação.
CREATE INDEX IF NOT EXISTS ix_company_domain
  ON public.tb_company (domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_company_name_norm
  ON public.tb_company (name_norm);
CREATE INDEX IF NOT EXISTS ix_company_phone
  ON public.tb_company (phone) WHERE phone IS NOT NULL;

-- Busca por raio: bounding box primeiro (isto), haversine na projeção.
CREATE INDEX IF NOT EXISTS ix_company_geo
  ON public.tb_company (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_company_cnae
  ON public.tb_company (main_cnae) WHERE main_cnae IS NOT NULL;

-- A fila de re-enriquecimento lê por aqui.
CREATE INDEX IF NOT EXISTS ix_company_enrichment
  ON public.tb_company (enrichment_status, enriched_at);

-- CNPJ é 14 dígitos ou não é CNPJ. O CHECK existe porque esta coluna é UNIQUE:
-- uma linha com "12.345.678/0001-90" e outra com "12345678000190" seriam duas
-- empresas para o banco e uma só para o mundo.
ALTER TABLE public.tb_company DROP CONSTRAINT IF EXISTS chk_company_cnpj_digits;
ALTER TABLE public.tb_company ADD CONSTRAINT chk_company_cnpj_digits
  CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$');

ALTER TABLE public.tb_company DROP CONSTRAINT IF EXISTS chk_company_enrichment_status;
ALTER TABLE public.tb_company ADD CONSTRAINT chk_company_enrichment_status
  CHECK (enrichment_status IN ('none','queued','partial','done','failed'));

ALTER TABLE public.tb_company DROP CONSTRAINT IF EXISTS chk_company_confidence;
ALTER TABLE public.tb_company ADD CONSTRAINT chk_company_confidence
  CHECK (confidence BETWEEN 0 AND 100);

-- Coordenada fora do planeta é erro de parse da fonte, não dado. Sem isto, um
-- lon/lat trocado (o OSM devolve `lat` e `lon`, o GeoJSON devolve o inverso)
-- entra em silêncio e a empresa aparece no meio do oceano.
ALTER TABLE public.tb_company DROP CONSTRAINT IF EXISTS chk_company_latlon;
ALTER TABLE public.tb_company ADD CONSTRAINT chk_company_latlon
  CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A PROVENIÊNCIA — de onde veio CADA campo
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ ESTA TABELA É O QUE IMPEDE A FONTE FRACA DE APAGAR A FORTE.
--
-- Sem ela, `tb_company` é uma pilha de últimos-a-escrever: o crawler acha um
-- telefone genérico no rodapé do site e sobrescreve o telefone que veio da
-- Receita, e ninguém descobre nunca — porque o campo continua preenchido e com
-- cara de certo. Com ela, cada escrita compara a confiança da fonte nova com a
-- da fonte que está lá (utils/companyConfidence.js) e só vence quem for melhor.
--
-- ⚠️ É TAMBÉM O QUE A TELA MOSTRA ("telefone: Receita Federal · 22/09/2026") e
-- o que torna possível responder a um pedido de correção sem adivinhar.
--
-- UNIQUE (empresa, campo, fonte): uma fonte tem UMA opinião por campo. Re-ler a
-- mesma fonte atualiza `value`/`last_seen_at` em vez de empilhar histórico —
-- histórico de crawl viraria a maior tabela do banco em semanas.
CREATE TABLE IF NOT EXISTS public.tb_company_source (
  id_source     BIGSERIAL     PRIMARY KEY,
  id_company    UUID          NOT NULL REFERENCES public.tb_company(id_company) ON DELETE CASCADE,
  field         VARCHAR(32)   NOT NULL,
  value         TEXT          NULL,
  source        VARCHAR(16)   NOT NULL,
  source_url    TEXT          NULL,
  confidence    SMALLINT      NOT NULL DEFAULT 50,
  first_seen_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_company_source_field
  ON public.tb_company_source (id_company, field, source);
CREATE INDEX IF NOT EXISTS ix_company_source_company
  ON public.tb_company_source (id_company);

-- Lista FECHADA de fontes. Fonte nova entra aqui numa migration nova E no
-- registry `src/integrations/companyProvider/` — declarada só num dos dois, ela
-- é aceita pelo banco e estoura na hora de gravar (ou o contrário: grava e
-- ninguém sabe ler).
ALTER TABLE public.tb_company_source DROP CONSTRAINT IF EXISTS chk_company_source_kind;
ALTER TABLE public.tb_company_source ADD CONSTRAINT chk_company_source_kind
  CHECK (source IN ('cnpj','osm','website','social','directory','manual'));

ALTER TABLE public.tb_company_source DROP CONSTRAINT IF EXISTS chk_company_source_conf;
ALTER TABLE public.tb_company_source ADD CONSTRAINT chk_company_source_conf
  CHECK (confidence BETWEEN 0 AND 100);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A FILA
-- ─────────────────────────────────────────────────────────────────────────────
-- Mesma forma da fila do atendente (mig 253), e pela mesma razão: descobrir uma
-- cidade inteira no Overpass leva dezenas de segundos e crawlear um site leva
-- segundos — nada disso pode acontecer dentro de uma requisição HTTP com alguém
-- olhando para uma ampulheta.
--
-- ⚠️ O DEDUPE É O CORAÇÃO DA ECONOMIA. `dedupe_key` é montado pelo service
-- ('discover:academia:SP:sao-bernardo-do-campo', 'enrich_website:<id>'), e o
-- índice parcial abaixo garante UM trabalho vivo por chave: dez pessoas pedindo
-- "academias em São Bernardo" no mesmo minuto geram UMA varredura do Overpass,
-- não dez. Sem ele, a plataforma se auto-DDoSaria contra um serviço público e
-- gratuito — que é exatamente como se perde acesso a ele.
CREATE TABLE IF NOT EXISTS public.tb_company_job (
  id_job          BIGSERIAL     PRIMARY KEY,
  kind            VARCHAR(24)   NOT NULL,
  dedupe_key      TEXT          NOT NULL,
  id_company      UUID          NULL REFERENCES public.tb_company(id_company) ON DELETE CASCADE,
  -- Quem pediu e de qual negócio. Os dois em SET NULL: o trabalho é da
  -- plataforma (o resultado serve todo mundo), então apagar a conta de quem
  -- pediu não pode apagar a empresa descoberta.
  requested_by    UUID          NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  id_profile      UUID          NULL REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL,
  payload         JSONB         NOT NULL DEFAULT '{}'::jsonb,
  status          VARCHAR(12)   NOT NULL DEFAULT 'pending',
  attempts        SMALLINT      NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  result          JSONB         NULL,
  skip_reason     TEXT          NULL,
  last_error      TEXT          NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_company_job_live
  ON public.tb_company_job (dedupe_key)
  WHERE status IN ('pending','running');

-- O `claimDue` lê por aqui (ver AiJobStorage para a mecânica).
CREATE INDEX IF NOT EXISTS ix_company_job_due
  ON public.tb_company_job (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_company_job_requester
  ON public.tb_company_job (requested_by, created_at DESC);

ALTER TABLE public.tb_company_job DROP CONSTRAINT IF EXISTS chk_company_job_kind;
ALTER TABLE public.tb_company_job ADD CONSTRAINT chk_company_job_kind
  CHECK (kind IN ('discover','enrich_cnpj','enrich_website','enrich_all'));

ALTER TABLE public.tb_company_job DROP CONSTRAINT IF EXISTS chk_company_job_status;
ALTER TABLE public.tb_company_job ADD CONSTRAINT chk_company_job_status
  CHECK (status IN ('pending','running','done','failed','skipped'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. AS LISTAS DE PROSPECÇÃO
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ A LISTA É DO NEGÓCIO (`id_profile` da comunidade), NÃO DA PESSOA.
--
-- É o que o produto pede: a prospecção é um pill DA COMUNIDADE BUSINESS, e a
-- barbearia continua tendo a lista dela quando a liderança muda de mãos. Pendurá-la
-- no usuário faria a lista sair junto com a pessoa — e o negócio perderia o
-- trabalho de prospecção que pagou.
--
-- `id_user` fica como AUTORIA (quem criou), não como dono.
CREATE TABLE IF NOT EXISTS public.tb_lead_list (
  id_list     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  id_profile  UUID        NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user     UUID        NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  name        TEXT        NOT NULL,
  note        TEXT        NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Duas listas com o mesmo nome no mesmo negócio são sempre engano de clique
-- duplo, nunca intenção. `lower()` porque "Academias ABC" e "academias abc" são
-- a mesma coisa para quem está olhando.
CREATE UNIQUE INDEX IF NOT EXISTS ux_lead_list_name
  ON public.tb_lead_list (id_profile, lower(name));
CREATE INDEX IF NOT EXISTS ix_lead_list_profile
  ON public.tb_lead_list (id_profile, created_at DESC);

-- ⚠️ OS CAMPOS DE CRM JÁ NASCEM AQUI, e isso NÃO é escopo inventado: o pedido
-- diz "evitar decisões arquiteturais que dificultem essa evolução". `stage` e
-- `owner_user` custam duas colunas hoje; acrescentá-los depois custaria uma
-- migration sobre uma tabela que já é o vínculo N:N de todo mundo.
--
-- A PK composta é o dedupe: a mesma empresa não entra duas vezes na lista.
CREATE TABLE IF NOT EXISTS public.tb_lead_list_item (
  id_list     UUID        NOT NULL REFERENCES public.tb_lead_list(id_list) ON DELETE CASCADE,
  id_company  UUID        NOT NULL REFERENCES public.tb_company(id_company) ON DELETE CASCADE,
  stage       VARCHAR(16) NOT NULL DEFAULT 'new',
  owner_user  UUID        NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  note        TEXT        NULL,
  added_by    UUID        NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_list, id_company)
);

CREATE INDEX IF NOT EXISTS ix_lead_list_item_company
  ON public.tb_lead_list_item (id_company);

ALTER TABLE public.tb_lead_list_item DROP CONSTRAINT IF EXISTS chk_lead_item_stage;
ALTER TABLE public.tb_lead_list_item ADD CONSTRAINT chk_lead_item_stage
  CHECK (stage IN ('new','contacted','qualified','won','lost'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. O OPT-OUT (LGPD)
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ A SUPRESSÃO É POR CHAVE, NÃO POR LINHA, e é por isso que ela é uma tabela
-- separada de `tb_company.suppressed_at`. Quem pede para sair não pede "apague
-- aquela linha": pede para não voltar. Com a chave (domínio, CNPJ ou e-mail)
-- guardada aqui, a descoberta de amanhã reconhece o pedido ANTES de criar a
-- empresa de novo — e o crawler nunca mais visita aquele domínio.
CREATE TABLE IF NOT EXISTS public.tb_company_suppression (
  id_suppression BIGSERIAL     PRIMARY KEY,
  kind           VARCHAR(8)    NOT NULL,
  value          TEXT          NOT NULL,
  reason         TEXT          NULL,
  created_by     UUID          NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_company_suppression
  ON public.tb_company_suppression (kind, value);

ALTER TABLE public.tb_company_suppression DROP CONSTRAINT IF EXISTS chk_company_suppression_kind;
ALTER TABLE public.tb_company_suppression ADD CONSTRAINT chk_company_suppression_kind
  CHECK (kind IN ('domain','cnpj','email'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. CACHE DE ÁREA DO OSM
-- ─────────────────────────────────────────────────────────────────────────────
-- Mesma ideia do `tb_cep_cache` (mig 202): a resposta é a mesma para todo mundo
-- e para sempre, então cachear aqui serve o site inteiro em vez de cada busca.
--
-- ⚠️ ELE EXISTE PORQUE "SÃO BERNARDO DO CAMPO" É AMBÍGUO NO OSM. Consultar o
-- Overpass por nome de área traz municípios homônimos de outros estados — e o
-- resultado seria uma busca em São Bernardo/MA respondendo por São Bernardo/SP,
-- sem erro nenhum. O geocoder resolve (uf, cidade) → id da área UMA vez, e daí
-- em diante o Overpass é consultado pelo ID, que não é ambíguo.
CREATE TABLE IF NOT EXISTS public.tb_osm_area_cache (
  uf           CHAR(2)      NOT NULL,
  city_norm    VARCHAR(160) NOT NULL,
  osm_area_id  BIGINT       NULL,
  display_name TEXT         NULL,
  -- NULL em osm_area_id com `checked_at` preenchido = "procurei e não achei".
  -- Sem esta distinção a plataforma re-consultaria o geocoder toda vez para uma
  -- cidade que ele não conhece.
  checked_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (uf, city_norm)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. OS BOTÕES (linha única)
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ CUSTO ZERO NO SEED, E ISSO É DECISÃO. O pedido diz para não implementar
-- monetização antes de entender o sistema, mas deixar a arquitetura pronta.
-- Então os preços existem, valem 0, e ligar a cobrança é um UPDATE — não uma
-- migration. Mesma disciplina de `condo_settings` (mig 196) e da cota de
-- anúncios que a mig 252 zerou em vez de apagar.
--
-- ⚠️ OS LIMITES DIÁRIOS, AO CONTRÁRIO, JÁ NASCEM VALENDO. Eles não são preço:
-- são o que impede uma conta de varrer o Overpass e o Nominatim até a
-- plataforma ser bloqueada por eles. Freio de uso nasce ligado.
CREATE TABLE IF NOT EXISTS public.prospeccao_settings (
  id                      SMALLINT    PRIMARY KEY DEFAULT 1,
  enrich_cost_polens      INT         NOT NULL DEFAULT 0,
  export_cost_polens      INT         NOT NULL DEFAULT 0,
  daily_discover_per_user INT         NOT NULL DEFAULT 20,
  daily_enrich_per_user   INT         NOT NULL DEFAULT 120,
  -- Quanto tempo uma descoberta de (categoria, cidade) vale antes de valer a
  -- pena varrer de novo. 7 dias: estabelecimento novo não abre de hora em hora.
  discovery_ttl_hours     INT         NOT NULL DEFAULT 168,
  -- O site do negócio muda mais que o cadastro dele na Receita.
  website_ttl_hours       INT         NOT NULL DEFAULT 720,
  cnpj_ttl_hours          INT         NOT NULL DEFAULT 4320,
  -- Teto de páginas por domínio no crawl. Seis cobre home + as cinco páginas
  -- de contato que o pedido lista, e nada além disso.
  crawl_max_pages         SMALLINT    NOT NULL DEFAULT 6,
  -- Teto de empresas devolvidas por varredura do Overpass. Freio contra pedir
  -- "restaurantes em São Paulo" e receber 40 mil linhas numa transação.
  discover_max_results    INT         NOT NULL DEFAULT 400,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_prospeccao_settings_singleton CHECK (id = 1)
);

INSERT INTO public.prospeccao_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. O KILL-SWITCH
-- ─────────────────────────────────────────────────────────────────────────────
-- Nasce LIGADA, como as outras flags de feature nova. Ela é segura ligada por
-- construção: sem ninguém abrindo o pill, nenhum trabalho é enfileirado e
-- nenhuma chamada externa acontece. Desligá-la esconde o pill E fecha as rotas.
INSERT INTO public.tb_feature_flag (flag_key, label, description)
VALUES (
  'prospeccao',
  'Prospecção (Leads)',
  'A base de empresas brasileiras dentro do Meu Negócio: procurar empresas por categoria e cidade (dados do OpenStreetMap), enriquecer com CNPJ público, site oficial e redes sociais, salvar em listas e exportar. Desligar esconde o pill Leads e fecha as rotas — as listas já salvas continuam no banco.'
)
ON CONFLICT (flag_key) DO NOTHING;
