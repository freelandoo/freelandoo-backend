-- =============================================================================
-- Migration 286: Freelandoo Arena — outdoors e mídia (Módulo 11 da Arena)
-- =============================================================================
-- Conceitos SEPARADOS (plano: freelandoo-arena/docs/architecture/M11_M12_AUDITORIA_E_PLANO.md):
--
--   tb_arena_ad_placement     — ESPAÇO físico comercializável. Identidade natural
--                               = ambiente : versão do mapa : versão do gerador :
--                               instância : slot. O id público é derivado dela
--                               (`ad-<uf>-<hash16>`) pelo exportador da Arena e
--                               sincronizado por scripts/arena-placements.js.
--                               Só slots de classe COMERCIAL entram: letreiro de
--                               loja nunca vira anúncio.
--   tb_arena_ad_campaign      — campanha. APROVAÇÃO de conteúdo (approval_status)
--                               é separada da OPERAÇÃO (op_status). "Agendada" é
--                               derivado: ativa e ainda antes do início.
--                               Janela [starts_at, ends_at): início inclusivo,
--                               fim exclusivo, relógio do banco (UTC).
--   tb_arena_ad_creative      — criativo VERSIONADO e imutável: o conteúdo de uma
--                               versão nunca muda (trigger); trocar a arte é criar
--                               a versão seguinte e apontar a campanha para ela.
--   tb_arena_ad_booking       — associação TEMPORAL campanha × espaço. Conflito
--                               (mesmo espaço, janelas sobrepostas, ambas ativas)
--                               é recusado no service com o espaço travado.
--   tb_arena_ad_signal        — sinais do CLIENTE (renderizado, exposição
--                               estimada, modal aberto, clique no CTA), já
--                               deduplicados por conta + espaço + criativo/versão
--                               + tipo + hora UTC. São sinais, não auditoria.
--   tb_arena_ad_video_session — sessão de reprodução VOLUNTÁRIA, criada e
--                               creditada pelo servidor (o navegador manda sinais,
--                               nunca o tempo assistido). Uma aberta por conta.
--
-- Não existe quarentena privada de mídia: os arquivos ficam em bucket/pasta
-- pública. Por isso a ingestão (npm run ads:ingest na Arena) só aceita criativo
-- JÁ aprovado por operador. Isto é declarado, não mascarado.
--
-- Retenção: sinais e sessões encerradas há mais de 90 dias são descartados pela
-- varredura do serviço (ArenaAdService.purgeOld).
--
-- Recuperação:
--   DROP TABLE public.tb_arena_ad_video_session, public.tb_arena_ad_signal,
--              public.tb_arena_ad_booking, public.tb_arena_ad_creative,
--              public.tb_arena_ad_campaign, public.tb_arena_ad_placement CASCADE;
--   DROP FUNCTION public.fn_arena_ad_creative_immutable();
--   DELETE FROM public.schema_migrations WHERE filename = '286_arena_ads.sql';
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_arena_ad_placement (
  placement_id       VARCHAR(64)   PRIMARY KEY,
  natural_key        VARCHAR(220)  NOT NULL,
  environment_id     VARCHAR(48)   NOT NULL,
  map_version        INTEGER       NOT NULL,
  generator_version  INTEGER       NOT NULL,
  instance_id        VARCHAR(64)   NOT NULL,
  slot               VARCHAR(48)   NOT NULL,
  asset_id           VARCHAR(64)   NOT NULL,
  slot_class         VARCHAR(16)   NOT NULL,
  x                  NUMERIC(9,3)  NOT NULL,
  y                  NUMERIC(9,3)  NOT NULL,
  -- largura / altura do quadrilátero do slot na escala 1x (orientação da arte).
  aspect             NUMERIC(8,4)  NOT NULL,
  is_active          BOOLEAN       NOT NULL DEFAULT TRUE,
  registry_revision  INTEGER       NOT NULL DEFAULT 1,
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_arena_ad_placement_id CHECK (placement_id ~ '^ad-[a-z]{2}-[0-9a-f]{16}$'),
  CONSTRAINT chk_arena_ad_placement_env CHECK (environment_id ~ '^br-[a-z]{2}$'),
  CONSTRAINT chk_arena_ad_placement_class CHECK (slot_class IN ('commercial', 'institutional', 'decorative', 'reserved')),
  CONSTRAINT chk_arena_ad_placement_aspect CHECK (aspect > 0 AND aspect < 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_ad_placement_natural
  ON public.tb_arena_ad_placement (natural_key);
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_ad_placement_slot
  ON public.tb_arena_ad_placement (environment_id, map_version, generator_version, instance_id, slot);
CREATE INDEX IF NOT EXISTS ix_arena_ad_placement_env
  ON public.tb_arena_ad_placement (environment_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.tb_arena_ad_campaign (
  id_campaign              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     VARCHAR(48)   NOT NULL,
  -- O que a tela mostra como "patrocinado por" (texto do anunciante, não traduzido).
  sponsor_label            VARCHAR(80)   NOT NULL,
  -- Responsável autorizado (operador interno). Nunca é exposto.
  responsible_label        VARCHAR(120)  NOT NULL,
  is_demo                  BOOLEAN       NOT NULL DEFAULT FALSE,
  approval_status          VARCHAR(12)   NOT NULL DEFAULT 'pending',
  approved_by_label        VARCHAR(120),
  approved_at              TIMESTAMPTZ,
  op_status                VARCHAR(12)   NOT NULL DEFAULT 'draft',
  starts_at                TIMESTAMPTZ   NOT NULL,
  ends_at                  TIMESTAMPTZ   NOT NULL,
  current_creative_version INTEGER,
  revision                 INTEGER       NOT NULL DEFAULT 1,
  notes                    VARCHAR(500),
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_arena_ad_campaign_code CHECK (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT chk_arena_ad_campaign_approval CHECK (approval_status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  CONSTRAINT chk_arena_ad_campaign_op CHECK (op_status IN ('draft', 'active', 'paused', 'ended')),
  CONSTRAINT chk_arena_ad_campaign_window CHECK (ends_at > starts_at),
  -- Ativar exige conteúdo aprovado: o banco recusa mesmo se o service errar.
  CONSTRAINT chk_arena_ad_campaign_active_approved CHECK (op_status <> 'active' OR approval_status = 'approved')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_ad_campaign_code ON public.tb_arena_ad_campaign (code);

CREATE TABLE IF NOT EXISTS public.tb_arena_ad_creative (
  id_creative        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  id_campaign        UUID          NOT NULL REFERENCES public.tb_arena_ad_campaign(id_campaign) ON DELETE CASCADE,
  version            INTEGER       NOT NULL,
  kind               VARCHAR(8)    NOT NULL,
  far_ref            VARCHAR(200)  NOT NULL,
  near_ref           VARCHAR(200)  NOT NULL,
  poster_ref         VARCHAR(200),
  video_ref          VARCHAR(200),
  video_duration_ms  INTEGER,
  video_mime         VARCHAR(32),
  -- Por arquivo: { ref: { mime, bytes, sha256, width, height } } — o que a ingestão mediu.
  assets             JSONB         NOT NULL,
  content_hash       CHAR(64)      NOT NULL,
  alt_text           VARCHAR(200)  NOT NULL,
  headline           VARCHAR(80)   NOT NULL,
  body               VARCHAR(280),
  cta_label          VARCHAR(32),
  cta_url            VARCHAR(500),
  approval_status    VARCHAR(12)   NOT NULL DEFAULT 'approved',
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_arena_ad_creative_version CHECK (version >= 1),
  CONSTRAINT chk_arena_ad_creative_kind CHECK (kind IN ('image', 'video')),
  CONSTRAINT chk_arena_ad_creative_refs CHECK (
    far_ref ~ '^arena/v[0-9]+/ads/[a-f0-9]{16}\.(png|jpg|webp)$'
    AND near_ref ~ '^arena/v[0-9]+/ads/[a-f0-9]{16}\.(png|jpg|webp)$'
    AND (poster_ref IS NULL OR poster_ref ~ '^arena/v[0-9]+/ads/[a-f0-9]{16}\.(png|jpg|webp)$')
    AND (video_ref IS NULL OR video_ref ~ '^arena/v[0-9]+/ads/[a-f0-9]{16}\.mp4$')
  ),
  CONSTRAINT chk_arena_ad_creative_video CHECK (
    (kind = 'image' AND video_ref IS NULL AND video_duration_ms IS NULL)
    OR (kind = 'video' AND video_ref IS NOT NULL AND poster_ref IS NOT NULL
        AND video_duration_ms BETWEEN 3000 AND 120000 AND video_mime = 'video/mp4')
  ),
  CONSTRAINT chk_arena_ad_creative_cta CHECK (
    (cta_url IS NULL AND cta_label IS NULL)
    OR (cta_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^\s@]*)?$' AND cta_label IS NOT NULL)
  ),
  CONSTRAINT chk_arena_ad_creative_approval CHECK (approval_status IN ('pending', 'approved', 'rejected', 'withdrawn'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_ad_creative_version ON public.tb_arena_ad_creative (id_campaign, version);

-- Versão imutável: só a aprovação (retirada por segurança) pode mudar.
CREATE OR REPLACE FUNCTION public.fn_arena_ad_creative_immutable() RETURNS trigger AS $$
BEGIN
  IF (NEW.id_campaign, NEW.version, NEW.kind, NEW.far_ref, NEW.near_ref, NEW.poster_ref, NEW.video_ref,
      NEW.video_duration_ms, NEW.video_mime, NEW.assets, NEW.content_hash, NEW.alt_text, NEW.headline,
      NEW.body, NEW.cta_label, NEW.cta_url)
     IS DISTINCT FROM
     (OLD.id_campaign, OLD.version, OLD.kind, OLD.far_ref, OLD.near_ref, OLD.poster_ref, OLD.video_ref,
      OLD.video_duration_ms, OLD.video_mime, OLD.assets, OLD.content_hash, OLD.alt_text, OLD.headline,
      OLD.body, OLD.cta_label, OLD.cta_url) THEN
    RAISE EXCEPTION 'arena_ad_creative_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_arena_ad_creative_immutable ON public.tb_arena_ad_creative;
CREATE TRIGGER trg_arena_ad_creative_immutable
  BEFORE UPDATE ON public.tb_arena_ad_creative
  FOR EACH ROW EXECUTE FUNCTION public.fn_arena_ad_creative_immutable();

CREATE TABLE IF NOT EXISTS public.tb_arena_ad_booking (
  id_booking    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  id_campaign   UUID          NOT NULL REFERENCES public.tb_arena_ad_campaign(id_campaign) ON DELETE CASCADE,
  placement_id  VARCHAR(64)   NOT NULL REFERENCES public.tb_arena_ad_placement(placement_id),
  starts_at     TIMESTAMPTZ   NOT NULL,
  ends_at       TIMESTAMPTZ   NOT NULL,
  status        VARCHAR(12)   NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  cancelled_at  TIMESTAMPTZ,
  CONSTRAINT chk_arena_ad_booking_window CHECK (ends_at > starts_at),
  CONSTRAINT chk_arena_ad_booking_status CHECK (status IN ('active', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS ix_arena_ad_booking_placement
  ON public.tb_arena_ad_booking (placement_id, starts_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_arena_ad_booking_campaign ON public.tb_arena_ad_booking (id_campaign);

CREATE TABLE IF NOT EXISTS public.tb_arena_ad_signal (
  id_signal        BIGSERIAL     PRIMARY KEY,
  id_user          UUID          NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  placement_id     VARCHAR(64)   NOT NULL,
  id_creative      UUID          NOT NULL,
  creative_version INTEGER       NOT NULL,
  id_campaign      UUID          NOT NULL,
  signal_type      VARCHAR(16)   NOT NULL,
  incentivized     BOOLEAN       NOT NULL DEFAULT FALSE,
  bucket_start     TIMESTAMPTZ   NOT NULL,
  received_at      TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_arena_ad_signal_type CHECK (signal_type IN ('rendered', 'exposure', 'modal_open', 'cta_click'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_ad_signal_dedupe
  ON public.tb_arena_ad_signal (id_user, placement_id, id_creative, signal_type, bucket_start);
CREATE INDEX IF NOT EXISTS ix_arena_ad_signal_campaign
  ON public.tb_arena_ad_signal (id_campaign, bucket_start);

CREATE TABLE IF NOT EXISTS public.tb_arena_ad_video_session (
  id_session        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user           UUID          NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  request_id        UUID          NOT NULL,
  placement_id      VARCHAR(64)   NOT NULL,
  id_campaign       UUID          NOT NULL,
  id_creative       UUID          NOT NULL,
  creative_version  INTEGER       NOT NULL,
  policy_version    INTEGER       NOT NULL,
  nonce_hash        CHAR(64)      NOT NULL,
  state             VARCHAR(12)   NOT NULL DEFAULT 'open',
  terminal_reason   VARCHAR(32),
  duration_ms       INTEGER       NOT NULL,
  incentivized      BOOLEAN       NOT NULL DEFAULT FALSE,
  started_at        TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  expires_at        TIMESTAMPTZ   NOT NULL,
  last_seq          INTEGER       NOT NULL DEFAULT 0,
  last_hash         CHAR(64),
  last_signal_at    TIMESTAMPTZ,
  last_media_ms     INTEGER       NOT NULL DEFAULT 0,
  playing           BOOLEAN       NOT NULL DEFAULT FALSE,
  credited_ms       INTEGER       NOT NULL DEFAULT 0,
  max_media_ms      INTEGER       NOT NULL DEFAULT 0,
  completed_at      TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  CONSTRAINT chk_arena_ad_vs_state CHECK (state IN ('open', 'completed', 'expired', 'superseded', 'cancelled', 'closed')),
  CONSTRAINT chk_arena_ad_vs_credit CHECK (credited_ms >= 0 AND credited_ms <= duration_ms),
  CONSTRAINT chk_arena_ad_vs_seq CHECK (last_seq >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_ad_vs_request ON public.tb_arena_ad_video_session (id_user, request_id);
-- Uma sessão ABERTA por conta: duas abas não acumulam reprodução simultânea.
CREATE UNIQUE INDEX IF NOT EXISTS ux_arena_ad_vs_open ON public.tb_arena_ad_video_session (id_user) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS ix_arena_ad_vs_user_day ON public.tb_arena_ad_video_session (id_user, started_at);
CREATE INDEX IF NOT EXISTS ix_arena_ad_vs_open_expiry ON public.tb_arena_ad_video_session (expires_at) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS ix_arena_ad_vs_campaign ON public.tb_arena_ad_video_session (id_campaign, started_at);
