-- 291 — MEU MUNDO 3D: bairros persistentes, lotes, casas e residências.
--
-- A primeira entrega (mm3d-01) desenhava um bairro DEMONSTRATIVO montado em
-- memória (meuMundoDemo.js), sem dono e sem banco. Esta migration é a
-- transição explícita para o bairro PERSISTENTE do ambiente de desenvolvimento:
-- os ids públicos ("lot-01".."lot-20", "house-01".."house-20") continuam os
-- mesmos, agora DENTRO de cada bairro registrado aqui.
--
-- Separação que não pode regredir:
--   BAIRRO  = registro permanente (estas tabelas).
--   SALA    = execução temporária do Colyseus que conecta quem está online
--             naquele bairro. Fechar a sala (todos offline, reinício do
--             servidor) NÃO toca em nada daqui.
--
-- ISOLAMENTO: estas tabelas não têm relação com saldo, Poléns, carteira,
-- inventário ou qualquer patrimônio da Freelandoo. `environment = 'dev'` marca
-- que tudo aqui é do ambiente em desenvolvimento (hoje restrito a
-- administradores) e não deve ser convertido em propriedade real.
--
-- Regras desta etapa, garantidas pelo BANCO:
--   - um bairro tem exatamente 20 lotes numerados 1..20 (CHECK + UNIQUE);
--   - cada lote tem uma casa (UNIQUE em id_lot), nível 01;
--   - uma residência ATIVA por usuário (índice único parcial);
--   - no máximo um titular ATIVO por casa (índice único parcial).
--
-- Regra FUTURA registrada (não implementada): quem vender a residência recebe
-- uma casa nível 01. Preço, taxa e o destino dessa casa ainda não foram
-- decididos — não inventar.

CREATE TABLE IF NOT EXISTS public.tb_mm_neighborhood (
  id_neighborhood UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq INTEGER NOT NULL,
  name TEXT NOT NULL,
  layout TEXT NOT NULL DEFAULT 'ring-20',
  capacity SMALLINT NOT NULL DEFAULT 20,
  environment TEXT NOT NULL DEFAULT 'dev',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_mm_neighborhood_seq UNIQUE (seq),
  CONSTRAINT chk_mm_neighborhood_layout CHECK (layout IN ('ring-20')),
  CONSTRAINT chk_mm_neighborhood_capacity CHECK (capacity = 20),
  CONSTRAINT chk_mm_neighborhood_env CHECK (environment IN ('dev'))
);

CREATE TABLE IF NOT EXISTS public.tb_mm_lot (
  id_lot UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_neighborhood UUID NOT NULL REFERENCES public.tb_mm_neighborhood(id_neighborhood) ON DELETE RESTRICT,
  lot_number SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_mm_lot_number UNIQUE (id_neighborhood, lot_number),
  CONSTRAINT chk_mm_lot_number CHECK (lot_number BETWEEN 1 AND 20)
);

CREATE TABLE IF NOT EXISTS public.tb_mm_house (
  id_house UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_lot UUID NOT NULL REFERENCES public.tb_mm_lot(id_lot) ON DELETE RESTRICT,
  level SMALLINT NOT NULL DEFAULT 1,
  variant SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_mm_house_lot UNIQUE (id_lot),
  CONSTRAINT chk_mm_house_level CHECK (level = 1),
  CONSTRAINT chk_mm_house_variant CHECK (variant BETWEEN 0 AND 11)
);

CREATE TABLE IF NOT EXISTS public.tb_mm_residence (
  id_residence UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_house UUID NOT NULL REFERENCES public.tb_mm_house(id_house) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ NULL,
  end_reason TEXT NULL,
  CONSTRAINT chk_mm_residence_status CHECK (status IN ('active', 'ended')),
  CONSTRAINT chk_mm_residence_ended CHECK ((status = 'active') = (ended_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_residence_user_active
  ON public.tb_mm_residence (id_user) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_residence_house_active
  ON public.tb_mm_residence (id_house) WHERE status = 'active';

-- Preferência de corpo do SELETOR ADMINISTRATIVO de teste. Não é loja,
-- guarda-roupa nem evolução corporal: é só o que o jogo recupera ao voltar.
CREATE TABLE IF NOT EXISTS public.tb_mm_avatar_pref (
  id_user UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT 'normal',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mm_avatar_body CHECK (body IN ('normal', 'slim', 'fat', 'strong'))
);
