-- =============================================================================
-- Migration 285: Freelandoo Arena — avatares, posse e aparência equipada (M10)
-- =============================================================================
-- Não existia catálogo de skins nem inventário de jogo (as Lojas de Funções e
-- de produtos vendem outra coisa: funções do site e bens físicos com retirada).
-- Extensão MÍNIMA, separando os conceitos:
--
--   tb_arena_avatar_model    — modelo/roupa do CATÁLOGO (gerado pelo build da
--                              Arena e sincronizado por scripts/arena-avatars.js,
--                              mesmo padrão do catálogo de categorias e dos
--                              postes). Nunca é apagado: sai de linha com
--                              status 'retired', e a posse continua existindo.
--   tb_arena_avatar_variant  — combinações [pele, cabelo] que o modelo SABE
--                              produzir. ready = os derivados existem.
--   tb_arena_avatar_grant    — DIREITO DE USO, com origem explícita:
--                              'default' (concessão padrão a toda conta),
--                              'admin', 'purchase' (reservado: não há compra
--                              integrada ainda). Revogar é marcar revoked_at;
--                              nunca apagar (é o histórico de posse).
--   tb_arena_player.avatar_* — a APARÊNCIA EQUIPADA, com revisão monotônica e
--                              escrita condicional (abas concorrentes).
--
-- Tom de pele e cor de cabelo são aparência PESSOAL: não são produto, não têm
-- posse e não são inferidos de nada. A conta só guarda os ids escolhidos.
--
-- Recuperação:
--   ALTER TABLE public.tb_arena_player DROP COLUMN IF EXISTS avatar_model_id,
--     DROP COLUMN IF EXISTS avatar_skin_id, DROP COLUMN IF EXISTS avatar_hair_id,
--     DROP COLUMN IF EXISTS avatar_revision, DROP COLUMN IF EXISTS avatar_updated_at;
--   DROP TABLE public.tb_arena_avatar_grant, public.tb_arena_avatar_variant,
--              public.tb_arena_avatar_model;
--   DELETE FROM public.schema_migrations WHERE filename = '285_arena_avatars.sql';
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_arena_avatar_model (
  model_id       VARCHAR(40)  PRIMARY KEY,
  labels         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  sort_order     INTEGER      NOT NULL DEFAULT 0,
  status         VARCHAR(12)  NOT NULL DEFAULT 'draft',
  default_grant  BOOLEAN      NOT NULL DEFAULT FALSE,
  sale_status    VARCHAR(24)  NOT NULL DEFAULT 'not_for_sale',
  asset_version  VARCHAR(40),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_arena_avatar_model_id CHECK (model_id ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  CONSTRAINT chk_arena_avatar_model_status CHECK (status IN ('draft', 'ready', 'retired')),
  -- Por que NÃO está à venda. 'for_sale' fica de fora de propósito: não há
  -- compra integrada, e a coluna não pode prometer o que o sistema não faz.
  CONSTRAINT chk_arena_avatar_model_sale CHECK (sale_status IN ('not_for_sale', 'rights_unconfirmed', 'owner_decision'))
);

CREATE TABLE IF NOT EXISTS public.tb_arena_avatar_variant (
  model_id    VARCHAR(40)  NOT NULL REFERENCES public.tb_arena_avatar_model(model_id) ON DELETE CASCADE,
  skin_id     VARCHAR(24)  NOT NULL,
  hair_id     VARCHAR(24)  NOT NULL,
  ready       BOOLEAN      NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (model_id, skin_id, hair_id),
  CONSTRAINT chk_arena_avatar_variant_ids CHECK (skin_id ~ '^[a-z0-9][a-z0-9-]{0,22}[a-z0-9]$' AND hair_id ~ '^[a-z0-9][a-z0-9-]{0,22}[a-z0-9]$')
);

CREATE TABLE IF NOT EXISTS public.tb_arena_avatar_grant (
  id_grant    BIGSERIAL    PRIMARY KEY,
  id_user     UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  model_id    VARCHAR(40)  NOT NULL REFERENCES public.tb_arena_avatar_model(model_id),
  source      VARCHAR(12)  NOT NULL,
  source_ref  VARCHAR(80),
  granted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ,
  CONSTRAINT chk_arena_avatar_grant_source CHECK (source IN ('default', 'admin', 'purchase'))
);

-- UMA posse viva por (conta, modelo): conceder de novo é no-op (idempotente).
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_avatar_grant_live
  ON public.tb_arena_avatar_grant (id_user, model_id) WHERE revoked_at IS NULL;
-- Um evento externo (pedido, ação de admin) concede no máximo uma vez.
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_avatar_grant_ref
  ON public.tb_arena_avatar_grant (source, source_ref) WHERE source_ref IS NOT NULL;

ALTER TABLE public.tb_arena_player
  ADD COLUMN IF NOT EXISTS avatar_model_id   VARCHAR(40) REFERENCES public.tb_arena_avatar_model(model_id),
  ADD COLUMN IF NOT EXISTS avatar_skin_id    VARCHAR(24),
  ADD COLUMN IF NOT EXISTS avatar_hair_id    VARCHAR(24),
  ADD COLUMN IF NOT EXISTS avatar_revision   INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ;

ALTER TABLE public.tb_arena_player DROP CONSTRAINT IF EXISTS chk_arena_player_avatar_all_or_none;
ALTER TABLE public.tb_arena_player ADD CONSTRAINT chk_arena_player_avatar_all_or_none CHECK (
  (avatar_model_id IS NULL AND avatar_skin_id IS NULL AND avatar_hair_id IS NULL)
  OR (avatar_model_id IS NOT NULL AND avatar_skin_id IS NOT NULL AND avatar_hair_id IS NOT NULL)
);
ALTER TABLE public.tb_arena_player DROP CONSTRAINT IF EXISTS chk_arena_player_avatar_revision;
ALTER TABLE public.tb_arena_player ADD CONSTRAINT chk_arena_player_avatar_revision CHECK (avatar_revision >= 0);
