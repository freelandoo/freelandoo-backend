-- =============================================================================
-- Migration 210: Pet, Carro e Games como modalidades de comunidade
-- =============================================================================
-- Decisão do Alex (2026-08-30): o clique na foto de perfil abre um MENU com
-- "Meu pet", "Meu carro", "Meus games", "Minha academia", "Meu condomínio",
-- "Minha rua" e "Minha comunidade". As três primeiras não existiam.
--
-- O pedido foi "elas são basicamente igual à academia, você pode copiar, só que
-- não precisa de CPF". Copiar a academia seria copiar a parte ERRADA: a
-- academia é entidade própria (tb_academy, mig 176) porque conversa com o
-- software da catraca — e é exatamente o CPF que amarra aluno↔catraca. Tirado o
-- CPF, o que sobra (mural, membros, ranking, headcard) já é a CASCA ÚNICA de
-- comunidade que condomínio e bairro passaram a usar em 2026-08-29.
--
-- Então as três entram como MODALIDADE (community_kind), do mesmo jeito que
-- 'condo' (mig 196) e 'neighborhood' (mig 204) entraram, e herdam sem rota nova
-- o feed, o "+" do headcard, curtida, comentário, salvos, denúncia e XP.
--
-- O que separa as três entre si é QUEM é o dono do assunto:
--   • car   → o assunto é o MODELO. Um modelo, uma comunidade, no site inteiro.
--             O primeiro que criar é o dono; quem chega depois ENTRA na dela.
--   • pet   → o assunto é o BICHO de uma pessoa. Cada dono cria o seu; dois
--             cachorros da mesma raça são duas comunidades diferentes.
--   • games → o assunto é o JOGO de uma pessoa (mesmo modelo do pet).
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

-- ─── 1. As modalidades ──────────────────────────────────────────────────────
-- Re-declaração do CHECK das migs 196/204 como SUPERSET: os quatro valores
-- antigos continuam válidos palavra por palavra.
ALTER TABLE public.tb_profile DROP CONSTRAINT IF EXISTS chk_profile_community_kind;
ALTER TABLE public.tb_profile ADD CONSTRAINT chk_profile_community_kind
  CHECK (community_kind IN
    ('common', 'academy', 'condo', 'neighborhood', 'pet', 'car', 'games'));

-- ─── 2. Taxonomia: as três não têm enxame ───────────────────────────────────
-- Mesma razão do bairro (mig 204 §2): "Golden Retriever" e "Honda Civic" não
-- são categoria profissional. Gravar um enxame só para agradar o CHECK é a
-- patologia da categoria fantasma — dado falso que depois vaza para vitrine e
-- busca. Superset de novo: as quatro alternativas anteriores ficam intactas e a
-- última só ganha as três modalidades novas.
ALTER TABLE public.tb_profile DROP CONSTRAINT IF EXISTS chk_profile_clan_taxonomy;
ALTER TABLE public.tb_profile ADD CONSTRAINT chk_profile_clan_taxonomy CHECK (
  ( is_clan = FALSE AND is_community = FALSE AND id_category IS NOT NULL ) OR
  ( is_clan = TRUE  AND id_machine  IS NOT NULL AND id_category IS NULL ) OR
  ( is_community = TRUE AND id_machine IS NOT NULL AND id_category IS NULL ) OR
  ( is_community = TRUE
    AND community_kind IN ('condo', 'neighborhood', 'pet', 'car', 'games')
    AND id_category IS NULL )
);

-- ─── 3. Carro: o catálogo de modelos ────────────────────────────────────────
-- Cache do par (marca, modelo) da FIPE. A tabela existe por três razões, e
-- nenhuma delas é "guardar tudo o que a FIPE tem": (a) dar um id ESTÁVEL para o
-- UNIQUE de uma comunidade por modelo; (b) preservar o rótulo do dia da criação
-- (a FIPE renomeia e aposenta modelo, e a comunidade não pode perder o nome
-- quando isso acontece); (c) permitir que o cadastro continue funcionando com a
-- FIPE fora do ar — o modelo que já virou comunidade uma vez está aqui.
CREATE TABLE IF NOT EXISTS public.tb_car_model (
  id_car_model  SERIAL PRIMARY KEY,
  brand_code    VARCHAR(16)  NOT NULL,
  brand_label   VARCHAR(80)  NOT NULL,
  model_code    VARCHAR(32)  NOT NULL,
  model_label   VARCHAR(120) NOT NULL,
  -- 'fipe' = veio do catálogo; 'manual' = digitado quando a FIPE não respondeu.
  source        VARCHAR(16)  NOT NULL DEFAULT 'fipe',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_car_model_codes
  ON public.tb_car_model (brand_code, model_code);

ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS id_car_model INTEGER NULL
    REFERENCES public.tb_car_model(id_car_model) ON DELETE RESTRICT;

-- UM Civic no site inteiro. É índice, não código: dois fundadores apertando
-- "criar" no mesmo segundo viram uma violação de constraint tratada (o segundo
-- entra na comunidade do primeiro), e não duas comunidades do mesmo carro
-- disputando qual é a verdadeira — que foi o cuidado que o bairro tomou na 204.
CREATE UNIQUE INDEX IF NOT EXISTS ux_profile_car_model
  ON public.tb_profile (id_car_model)
  WHERE community_kind = 'car' AND deleted_at IS NULL;

-- ─── 4. Pet: raças e o bicho ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_pet_breed (
  id_breed   SERIAL PRIMARY KEY,
  species    VARCHAR(16) NOT NULL,
  slug       VARCHAR(80) NOT NULL,
  label      VARCHAR(80) NOT NULL,
  -- Vira-lata / SRD: a linha existe para ser ESCOLHÍVEL na lista, não para ser
  -- tratada como raça. É o caso mais comum do Brasil e não pode virar "outro".
  is_mixed   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_pet_breed_species CHECK (species IN ('dog', 'cat', 'other'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pet_breed_species_slug
  ON public.tb_pet_breed (species, slug);

CREATE TABLE IF NOT EXISTS public.tb_community_pet (
  id_profile   UUID PRIMARY KEY
    REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  species      VARCHAR(16) NOT NULL,
  id_breed     INTEGER NULL
    REFERENCES public.tb_pet_breed(id_breed) ON DELETE SET NULL,
  -- Rótulo congelado no ato: a comunidade não pode ficar sem raça se alguém
  -- desativar a linha do catálogo depois (é o mesmo motivo do model_label).
  breed_label  VARCHAR(80) NULL,
  is_mixed     BOOLEAN NOT NULL DEFAULT FALSE,
  birth_year   SMALLINT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_community_pet_species CHECK (species IN ('dog', 'cat', 'other'))
);

-- Seed das raças. Fill-if-absent: a lista é ponto de partida editável, não
-- verdade — quem cadastrar um pet fora dela usa "Outra raça", que grava o
-- rótulo digitado em breed_label sem sujar o catálogo.
INSERT INTO public.tb_pet_breed (species, slug, label, is_mixed) VALUES
  ('dog', 'vira-lata',            'Vira-lata (SRD)',        TRUE),
  ('dog', 'shih-tzu',             'Shih Tzu',               FALSE),
  ('dog', 'poodle',               'Poodle',                 FALSE),
  ('dog', 'yorkshire',            'Yorkshire Terrier',      FALSE),
  ('dog', 'pinscher',             'Pinscher',               FALSE),
  ('dog', 'lhasa-apso',           'Lhasa Apso',             FALSE),
  ('dog', 'maltes',               'Maltês',                 FALSE),
  ('dog', 'golden-retriever',     'Golden Retriever',       FALSE),
  ('dog', 'labrador',             'Labrador Retriever',     FALSE),
  ('dog', 'pastor-alemao',        'Pastor Alemão',          FALSE),
  ('dog', 'bulldog-frances',      'Bulldog Francês',        FALSE),
  ('dog', 'bulldog-ingles',       'Bulldog Inglês',         FALSE),
  ('dog', 'pug',                  'Pug',                    FALSE),
  ('dog', 'beagle',               'Beagle',                 FALSE),
  ('dog', 'rottweiler',           'Rottweiler',             FALSE),
  ('dog', 'pitbull',              'Pit Bull',               FALSE),
  ('dog', 'border-collie',        'Border Collie',          FALSE),
  ('dog', 'dachshund',            'Dachshund (salsicha)',   FALSE),
  ('dog', 'spitz-alemao',         'Spitz Alemão (Lulu)',    FALSE),
  ('dog', 'chihuahua',            'Chihuahua',              FALSE),
  ('dog', 'husky-siberiano',      'Husky Siberiano',        FALSE),
  ('dog', 'akita',                'Akita',                  FALSE),
  ('dog', 'shiba-inu',            'Shiba Inu',              FALSE),
  ('dog', 'boxer',                'Boxer',                  FALSE),
  ('dog', 'cocker-spaniel',       'Cocker Spaniel',         FALSE),
  ('dog', 'schnauzer',            'Schnauzer',              FALSE),
  ('dog', 'dalmata',              'Dálmata',                FALSE),
  ('dog', 'doberman',             'Doberman',               FALSE),
  ('dog', 'basset-hound',         'Basset Hound',           FALSE),
  ('dog', 'weimaraner',           'Weimaraner',             FALSE),
  ('dog', 'pastor-belga',         'Pastor Belga',           FALSE),
  ('dog', 'sao-bernardo',         'São Bernardo',           FALSE),
  ('dog', 'chow-chow',            'Chow Chow',              FALSE),
  ('dog', 'fila-brasileiro',      'Fila Brasileiro',        FALSE),
  ('dog', 'outra',                'Outra raça',             FALSE),
  ('cat', 'vira-lata',            'Vira-lata (SRD)',        TRUE),
  ('cat', 'siames',               'Siamês',                 FALSE),
  ('cat', 'persa',                'Persa',                  FALSE),
  ('cat', 'maine-coon',           'Maine Coon',             FALSE),
  ('cat', 'angora',               'Angorá',                 FALSE),
  ('cat', 'ragdoll',              'Ragdoll',                FALSE),
  ('cat', 'bengal',               'Bengal',                 FALSE),
  ('cat', 'sphynx',               'Sphynx',                 FALSE),
  ('cat', 'british-shorthair',    'British Shorthair',      FALSE),
  ('cat', 'scottish-fold',        'Scottish Fold',          FALSE),
  ('cat', 'exotico',              'Exótico',                FALSE),
  ('cat', 'himalaio',             'Himalaio',               FALSE),
  ('cat', 'american-shorthair',   'American Shorthair',     FALSE),
  ('cat', 'norueges-da-floresta', 'Norueguês da Floresta',  FALSE),
  ('cat', 'outra',                'Outra raça',             FALSE),
  ('other', 'passaro',            'Pássaro',                FALSE),
  ('other', 'coelho',             'Coelho',                 FALSE),
  ('other', 'hamster',            'Hamster',                FALSE),
  ('other', 'porquinho-da-india', 'Porquinho-da-índia',     FALSE),
  ('other', 'peixe',              'Peixe',                  FALSE),
  ('other', 'tartaruga',          'Tartaruga',              FALSE),
  ('other', 'reptil',             'Réptil',                 FALSE),
  ('other', 'cavalo',             'Cavalo',                 FALSE),
  ('other', 'outro',              'Outro animal',           FALSE)
ON CONFLICT (species, slug) DO NOTHING;

-- ─── 5. Games ───────────────────────────────────────────────────────────────
-- Mesmo modelo do pet: um por jogo do usuário, sem catálogo global. Não existe
-- "dono do Minecraft" — o que a pessoa cria é o espaço DELA sobre aquele jogo.
CREATE TABLE IF NOT EXISTS public.tb_community_game (
  id_profile   UUID PRIMARY KEY
    REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  platform     VARCHAR(24)  NOT NULL,
  game_title   VARCHAR(120) NOT NULL,
  gamertag     VARCHAR(60)  NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_community_game_platform CHECK (platform IN
    ('pc', 'playstation', 'xbox', 'nintendo', 'mobile', 'retro', 'outra'))
);

-- ─── 6. Kill-switches ───────────────────────────────────────────────────────
-- Nascem LIGADAS, como a 'condominio' e a 'bairro': o Painel de Controle serve
-- para DESLIGAR se o lançamento precisar ser segurado, não para lembrar de
-- ligar. Uma flag por modalidade (e não uma só) porque elas podem ser seguradas
-- em momentos diferentes — o carro depende da FIPE, o pet não depende de nada.
INSERT INTO public.tb_feature_flag (flag_key, label, description, is_enabled)
VALUES
  ('pet', 'Comunidades de pet',
   'Comunidade do bicho de estimação: cada dono cria a do pet dele escolhendo espécie e raça (ou vira-lata). Desligar esconde a criação; as comunidades já criadas continuam funcionando.',
   TRUE),
  ('carro', 'Comunidades de carro',
   'Comunidade por modelo de carro (marca/modelo da FIPE): uma por modelo no site inteiro, quem chega depois entra na existente. Desligar esconde a criação e a entrada por modelo.',
   TRUE),
  ('games', 'Comunidades de games',
   'Comunidade de jogo: cada pessoa cria a dela escolhendo plataforma e título. Desligar esconde a criação; as comunidades já criadas continuam funcionando.',
   TRUE)
ON CONFLICT (flag_key) DO NOTHING;
