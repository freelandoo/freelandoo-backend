-- 340 — MEU MUNDO 3D B3 (2026-11-08): PERSONAGENS no lugar das skins.
--
-- Decisões do Alex (docs/CRONOGRAMA_2026-11.md, "B3 — decisões"):
--  • vários personagens por jogador e UM ativo (status 'alive'); os outros ficam na
--    CÁPSULA (status 'capsule'), congelados — a vida preguiçosa (utils/meuMundoLife.js)
--    não simula quem está guardado, e ao descongelar desloca os instantes gravados pelo
--    tempo guardado (Life.thaw). 5 vagas (utils/meuMundoCharacters.js CAPSULE.SLOTS).
--  • FUSÃO consome os dois pais (status 'fused', fused_into = o filho).
--  • as SKINS viram ESPÉCIES: quem tinha uma ganha um personagem daquela espécie, que
--    nasce com 1 m (o personagem é criado pela regra JS no próximo acesso da pessoa, a
--    partir da linha de tb_mm_character_grant gravada aqui). O vestuário sai do jogo:
--    tb_mm_avatar_pref.skin volta a 'standard' e tb_mm_skin_owned fica só como histórico.
--  • o hóspede de hoje de cada jogador vira o primeiro personagem (mesma linha: atributos,
--    idade e alma ficam), com a espécie = a classe do jogador.
--  • CERTIFICADO: número de série único + código da página pública; pais (parent_a/b),
--    geração da linhagem (lineage_gen) e a genética de nascença (genetics; NULL = sai da
--    semente, que é determinística).
--  • Pronto para o mercado (B4) e os prêmios (B9): dono com histórico
--    (tb_mm_character_owner) e entrega de personagem por grant (origem + referência única).
--
-- Idempotente: pode rodar de novo sem duplicar nada (IF NOT EXISTS, ON CONFLICT, WHERE … IS NULL).

-- ═══ status: superset com o MESMO nome da constraint ═══
ALTER TABLE public.tb_mm_character DROP CONSTRAINT IF EXISTS chk_mm_character_status;
ALTER TABLE public.tb_mm_character
  ADD CONSTRAINT chk_mm_character_status CHECK (status IN ('alive', 'dead', 'capsule', 'fused'));

-- ═══ colunas do personagem ═══
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS species TEXT NULL;
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS sex TEXT NULL;
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS serial BIGINT NULL;
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS cert_code TEXT NULL;
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS lineage_gen INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS parent_a UUID NULL;
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS parent_b UUID NULL;
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'hospede';
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS genetics JSONB NULL;
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ NULL;
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS fused_at TIMESTAMPTZ NULL;
ALTER TABLE public.tb_mm_character ADD COLUMN IF NOT EXISTS fused_into UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mm_character_species') THEN
    ALTER TABLE public.tb_mm_character
      ADD CONSTRAINT chk_mm_character_species CHECK (species IS NULL OR species ~ '^[a-z0-9_]{1,32}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mm_character_sex') THEN
    ALTER TABLE public.tb_mm_character
      ADD CONSTRAINT chk_mm_character_sex CHECK (sex IS NULL OR sex IN ('m', 'f'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mm_character_origin') THEN
    ALTER TABLE public.tb_mm_character
      ADD CONSTRAINT chk_mm_character_origin CHECK (origin IN ('hospede', 'heir', 'skin', 'fusion', 'prize', 'market', 'gift', 'admin_test'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mm_character_lineage') THEN
    ALTER TABLE public.tb_mm_character
      ADD CONSTRAINT chk_mm_character_lineage CHECK (lineage_gen >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mm_character_parent_a') THEN
    ALTER TABLE public.tb_mm_character
      ADD CONSTRAINT fk_mm_character_parent_a FOREIGN KEY (parent_a) REFERENCES public.tb_mm_character(id_character) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mm_character_parent_b') THEN
    ALTER TABLE public.tb_mm_character
      ADD CONSTRAINT fk_mm_character_parent_b FOREIGN KEY (parent_b) REFERENCES public.tb_mm_character(id_character) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_mm_character_fused_into') THEN
    ALTER TABLE public.tb_mm_character
      ADD CONSTRAINT fk_mm_character_fused_into FOREIGN KEY (fused_into) REFERENCES public.tb_mm_character(id_character) ON DELETE SET NULL;
  END IF;
END $$;

-- ═══ o hóspede de hoje vira o primeiro personagem: espécie e sexo = a classe do jogador ═══
UPDATE public.tb_mm_character ch
   SET species = k.clan, sex = k.sex
  FROM public.tb_mm_clan k
 WHERE k.id_user = ch.id_user AND ch.species IS NULL;

-- Linhagem dos hóspedes que vieram depois de uma morte: herdeiro do anterior (o mesmo
-- que a regra de hoje faz no newcomer).
UPDATE public.tb_mm_character ch
   SET origin = 'heir',
       lineage_gen = ch.generation,
       parent_a = (SELECT p.id_character FROM public.tb_mm_character p
                    WHERE p.id_user = ch.id_user AND p.generation = ch.generation - 1)
 WHERE ch.generation > 1 AND ch.origin = 'hospede' AND ch.parent_a IS NULL;

-- ═══ número de série (ordem de nascimento) ═══
CREATE SEQUENCE IF NOT EXISTS public.seq_mm_character_serial;
WITH todo AS (
  SELECT id_character,
         ROW_NUMBER() OVER (ORDER BY born_at, id_character)
           + COALESCE((SELECT MAX(serial) FROM public.tb_mm_character), 0) AS n
    FROM public.tb_mm_character
   WHERE serial IS NULL
)
UPDATE public.tb_mm_character ch SET serial = todo.n FROM todo WHERE todo.id_character = ch.id_character;
SELECT setval('public.seq_mm_character_serial', GREATEST(COALESCE((SELECT MAX(serial) FROM public.tb_mm_character), 0), 1));
ALTER TABLE public.tb_mm_character ALTER COLUMN serial SET DEFAULT nextval('public.seq_mm_character_serial');
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_character_serial ON public.tb_mm_character (serial);

-- ═══ código da página pública do certificado (não dá para adivinhar a partir do número) ═══
UPDATE public.tb_mm_character
   SET cert_code = substr(md5(id_character::text || random()::text || clock_timestamp()::text), 1, 12)
 WHERE cert_code IS NULL;
ALTER TABLE public.tb_mm_character
  ALTER COLUMN cert_code SET DEFAULT substr(md5(gen_random_uuid()::text || random()::text), 1, 12);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_character_cert_code ON public.tb_mm_character (cert_code);

-- ═══ índices da cápsula e do ranking ═══
CREATE INDEX IF NOT EXISTS ix_mm_character_capsule ON public.tb_mm_character (id_user) WHERE status = 'capsule';
CREATE INDEX IF NOT EXISTS ix_mm_character_parents ON public.tb_mm_character (parent_a, parent_b);
-- Ranking do Poder: o melhor vivo de cada jogador, contando os da cápsula (congelados
-- com o poder que tinham).
CREATE INDEX IF NOT EXISTS idx_mm_character_power_rank_b3
  ON public.tb_mm_character (power DESC, power_at ASC)
  WHERE status IN ('alive', 'capsule') AND power IS NOT NULL;

-- ═══ dono com histórico (B4: transferência; aqui só a origem) ═══
CREATE TABLE IF NOT EXISTS public.tb_mm_character_owner (
  id_owner BIGSERIAL PRIMARY KEY,
  id_character UUID NOT NULL REFERENCES public.tb_mm_character(id_character) ON DELETE CASCADE,
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  since TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  until TIMESTAMPTZ NULL,
  reason TEXT NOT NULL DEFAULT 'origin',
  CONSTRAINT chk_mm_character_owner_reason CHECK (reason IN ('origin', 'market', 'prize', 'gift', 'admin'))
);
CREATE INDEX IF NOT EXISTS ix_mm_character_owner_char ON public.tb_mm_character_owner (id_character, since);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_character_owner_open ON public.tb_mm_character_owner (id_character) WHERE until IS NULL;

INSERT INTO public.tb_mm_character_owner (id_character, id_user, since, reason)
SELECT ch.id_character, ch.id_user, ch.born_at, 'origin'
  FROM public.tb_mm_character ch
 WHERE NOT EXISTS (SELECT 1 FROM public.tb_mm_character_owner o WHERE o.id_character = ch.id_character);

-- ═══ personagens a entregar (conversão das skins; depois B9 prêmios e presentes) ═══
-- O serviço da vida (MeuMundoLifeService.withLife) cria o personagem com a regra JS
-- (Life.birth) na próxima vez que a pessoa entra e marca claimed_at/id_character.
CREATE TABLE IF NOT EXISTS public.tb_mm_character_grant (
  id_grant UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  species TEXT NOT NULL,
  sex TEXT NOT NULL,
  source TEXT NOT NULL,
  ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ NULL,
  id_character UUID NULL REFERENCES public.tb_mm_character(id_character) ON DELETE SET NULL,
  CONSTRAINT chk_mm_character_grant_species CHECK (species ~ '^[a-z0-9_]{1,32}$'),
  CONSTRAINT chk_mm_character_grant_sex CHECK (sex IN ('m', 'f')),
  CONSTRAINT chk_mm_character_grant_source CHECK (source IN ('skin', 'prize', 'gift', 'admin_test')),
  CONSTRAINT ux_mm_character_grant UNIQUE (id_user, source, ref)
);
CREATE INDEX IF NOT EXISTS ix_mm_character_grant_open ON public.tb_mm_character_grant (id_user) WHERE claimed_at IS NULL;

-- Skin → espécie (espelho de SKIN_SPECIES em features/meu-mundo/characters/rules.ts; o
-- unit test/unit/meuMundoCharacters.test.js confere esta tabela). "feminina" fica de fora.
INSERT INTO public.tb_mm_character_grant (id_user, species, sex, source, ref, created_at)
SELECT so.id_user, m.species, m.sex, 'skin', so.skin, so.bought_at
  FROM public.tb_mm_skin_owned so
  JOIN (VALUES
    ('sergio', 'sergio', 'm'),
    ('ekaterina', 'ekaterina', 'f'),
    ('aurion', 'aurion', 'm'),
    ('morkhan', 'morkhan', 'm'),
    ('kragor', 'kragor', 'm'),
    ('zephyra', 'zephyra', 'f'),
    ('maru', 'maru', 'm'),
    ('iris', 'iris', 'f'),
    ('noctis', 'noctis', 'm'),
    ('aeryn', 'aeryn', 'f'),
    ('ciborgue', 'ciborgue', 'm'),
    ('cavaleiro', 'cavaleiro', 'm'),
    ('golem', 'golem', 'm'),
    ('garras', 'garras', 'f'),
    ('brutamontes', 'brutamontes', 'm'),
    ('raposa', 'raposa', 'm'),
    ('raposa-f', 'raposa', 'f'),
    ('raposa-adulto', 'raposa', 'm'),
    ('raposa-adulta', 'raposa', 'f'),
    ('vampiro', 'vampiro', 'm'),
    ('vampira', 'vampiro', 'f'),
    ('vampiro-adulto', 'vampiro', 'm'),
    ('vampira-adulta', 'vampiro', 'f')
  ) AS m(skin, species, sex) ON m.skin = so.skin
ON CONFLICT (id_user, source, ref) DO NOTHING;

-- ═══ o vestuário sai do jogo ═══
UPDATE public.tb_mm_avatar_pref SET skin = 'standard', updated_at = NOW() WHERE skin IS DISTINCT FROM 'standard';
