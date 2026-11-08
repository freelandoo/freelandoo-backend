-- =============================================================================
-- Migration 338: A2 + A3 + A4 — VITRINES (cronograma 2026-11, aprovado 08/11)
--
--   A2  chaves no perfil: "Preciso de emprego" e "Preciso pagar dívidas"
--   A4  quatro abas em TODA comunidade: Produtos, Serviços, Empregos, Dívidas
--       (Produtos/Serviços = a vitrine da mig 198, agora em qualquer modalidade
--       e GRÁTIS no começo pela cota de cortesia que a mig 252 deixou em zero)
--   A2  feed de boletos: quem ajuda paga no app do PRÓPRIO banco pela linha
--       digitável. A Freelandoo NÃO recebe nem repassa dinheiro.
--   A3  enxame "Trabalhos fora do comum" com categorias próprias, só 18+
--
-- ⚠️ NENHUMA TABELA ANTIGA É RENOMEADA E NENHUMA MIGRATION ANTIGA É TOCADA:
-- `tb_condo_listing` continua com o nome da mig 198 (checksum), e a vitrine de
-- qualquer comunidade grava nela com `id_condo` = id da comunidade.
--
-- Idempotente.
-- =============================================================================

-- ─── 1. As chaves da pessoa (A2) ────────────────────────────────────────────
-- Moram em tb_user, e não no perfil: quem precisa de emprego ou de ajuda com
-- dívida é a PESSOA (o perfil-conta é a pessoa; não existe hierarquia), e é
-- nela que o CPF também mora.
ALTER TABLE public.tb_user
  ADD COLUMN IF NOT EXISTS needs_job          BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS needs_job_at       TIMESTAMPTZ  NULL,
  ADD COLUMN IF NOT EXISTS job_pitch          VARCHAR(280) NULL,
  ADD COLUMN IF NOT EXISTS needs_debt_help    BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS needs_debt_help_at TIMESTAMPTZ  NULL;

CREATE INDEX IF NOT EXISTS idx_user_needs_job
  ON public.tb_user (needs_job_at DESC)
  WHERE needs_job = TRUE;

-- ─── 2. Vitrine grátis no começo (A4) ───────────────────────────────────────
-- A mig 252 zerou a cota de cortesia e deixou as colunas como kill-switch.
-- O Alex decidiu "tudo grátis no começo": a cota volta a valer, alta o
-- bastante para não ser teto na prática, e o anúncio de cortesia nasce no ar
-- por `free_listing_months`. Voltar a cobrar = um UPDATE em condo_settings
-- (free_*_listings = 0), sem deploy — a mensalidade da mig 252 segue intacta.
ALTER TABLE public.condo_settings
  ADD COLUMN IF NOT EXISTS free_listing_months INT NOT NULL DEFAULT 12;

ALTER TABLE public.condo_settings
  DROP CONSTRAINT IF EXISTS condo_settings_free_listing_months_chk;
ALTER TABLE public.condo_settings
  ADD CONSTRAINT condo_settings_free_listing_months_chk
  CHECK (free_listing_months BETWEEN 1 AND 120);

-- O runner aplica cada migration uma vez (schema_migrations); a condição de
-- zero só evita pisar num valor que alguém já tenha mudado à mão.
UPDATE public.condo_settings
   SET free_service_listings = 50,
       free_product_listings = 50,
       updated_at            = NOW()
 WHERE id = 1
   AND free_service_listings = 0
   AND free_product_listings = 0
;

-- O override por comunidade que a mig 252 escreveu como 0 explícito venceria o
-- global no COALESCE e deixaria um prédio só cobrando. 0 ali não foi decisão
-- de ninguém (foi a própria 252): volta a herdar.
UPDATE public.tb_condo_config
   SET free_service_listings = NULL,
       free_product_listings = NULL,
       updated_at            = NOW()
 WHERE free_service_listings = 0
   AND free_product_listings = 0
;

-- ─── 3. Feed de boletos (A2) ────────────────────────────────────────────────
-- Régua configurável (singleton, como tb_community_listing_settings). Os
-- números moram aqui e não no service: mudar o teto é um UPDATE.
CREATE TABLE IF NOT EXISTS public.tb_debt_settings (
  id                INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_open          INT         NOT NULL DEFAULT 3     CHECK (max_open >= 0),
  max_amount_cents  INT         NOT NULL DEFAULT 50000 CHECK (max_amount_cents > 0),
  reserve_minutes   INT         NOT NULL DEFAULT 30    CHECK (reserve_minutes BETWEEN 5 AND 240),
  helper_emerald    INT         NOT NULL DEFAULT 200   CHECK (helper_emerald >= 0),
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        UUID        NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);
INSERT INTO public.tb_debt_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- O boleto. ⚠️ LGPD: NÃO existe coluna de nome, CPF ou endereço do pagador, e
-- nenhuma imagem do boleto é guardada. O que se publica é beneficiário (texto
-- informado e conferido pela moderação), valor e vencimento — os dois últimos
-- LIDOS DA LINHA, nunca digitados (no de concessionária o vencimento não está
-- no código e vem informado).
--
-- Estados:
--   review   → esperando a moderação conferir o beneficiário (fora do feed)
--   open     → no feed; "vou pagar" reserva por reserve_minutes (lazy)
--   claimed  → alguém anexou comprovante; o dono confere
--   paid     → o dono confirmou: sai do feed
--   canceled → o dono retirou
--   removed  → a moderação retirou (denúncia, beneficiário recusado)
-- Vencido não é estado: é lido no SELECT (due_date < hoje em Brasília).
CREATE TABLE IF NOT EXISTS public.tb_debt_bill (
  id_bill          BIGSERIAL    PRIMARY KEY,
  id_user          UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  line_digits      VARCHAR(48)  NOT NULL CHECK (line_digits ~ '^[0-9]{47,48}$'),
  bill_kind        VARCHAR(8)   NOT NULL CHECK (bill_kind IN ('bank', 'utility')),
  amount_cents     INT          NOT NULL CHECK (amount_cents > 0),
  due_date         DATE         NOT NULL,
  beneficiary      VARCHAR(120) NOT NULL,
  status           VARCHAR(10)  NOT NULL DEFAULT 'review'
                     CHECK (status IN ('review', 'open', 'claimed', 'paid', 'canceled', 'removed')),
  reserved_by      UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  reserved_until   TIMESTAMPTZ  NULL,
  paid_by          UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  -- Comprovante de quem pagou: R2 PRIVADO (sem URL pública), apagado assim que
  -- o dono confirma ou recusa. A key some junto (proof_purged_at fica).
  proof_key        TEXT         NULL,
  proof_at         TIMESTAMPTZ  NULL,
  proof_purged_at  TIMESTAMPTZ  NULL,
  reviewed_by      UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ  NULL,
  removed_reason   VARCHAR(280) NULL,
  confirmed_at     TIMESTAMPTZ  NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Linha repetida já aberta não entra (dois pedidos de ajuda para o mesmo
-- boleto seriam duas pessoas pagando a mesma conta).
CREATE UNIQUE INDEX IF NOT EXISTS ux_debt_bill_line_live
  ON public.tb_debt_bill (line_digits)
  WHERE status IN ('review', 'open', 'claimed');

CREATE INDEX IF NOT EXISTS idx_debt_bill_feed
  ON public.tb_debt_bill (due_date, id_bill)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_debt_bill_owner
  ON public.tb_debt_bill (id_user, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_debt_bill_helper
  ON public.tb_debt_bill (paid_by)
  WHERE status = 'paid';

-- Denúncia: uma por pessoa por boleto.
CREATE TABLE IF NOT EXISTS public.tb_debt_report (
  id_report    BIGSERIAL    PRIMARY KEY,
  id_bill      BIGINT       NOT NULL REFERENCES public.tb_debt_bill(id_bill) ON DELETE CASCADE,
  id_reporter  UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  reason       VARCHAR(280) NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ  NULL,
  resolved_by  UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  CONSTRAINT ux_debt_report_once UNIQUE (id_bill, id_reporter)
);

CREATE INDEX IF NOT EXISTS idx_debt_report_open
  ON public.tb_debt_report (created_at)
  WHERE resolved_at IS NULL;

-- ─── 4. Enxame "Trabalhos fora do comum" (A3) ───────────────────────────────
-- Idade mínima por enxame: regra no BANCO (trigger), porque a profissão é
-- gravada por mais de uma porta (onboarding, criar perfil, editar perfil) e
-- um guard só no service esquecido em uma delas deixaria menor entrar.
ALTER TABLE public.tb_machine
  ADD COLUMN IF NOT EXISTS min_age INT NULL;

ALTER TABLE public.tb_machine
  DROP CONSTRAINT IF EXISTS tb_machine_min_age_chk;
ALTER TABLE public.tb_machine
  ADD CONSTRAINT tb_machine_min_age_chk
  CHECK (min_age IS NULL OR min_age BETWEEN 0 AND 120);

INSERT INTO public.tb_machine
  (slug, name, display_order, color_from, color_to, color_glow, color_ring,
   color_accent, color_text, description, icon_name, is_active, min_age)
VALUES
  ('fora_do_comum', 'Enxame de Trabalhos fora do comum', 16,
   '#0f766e', '#14b8a6', 'rgba(20,184,166,0.45)', 'rgba(20,184,166,0.7)',
   '#2dd4bf', '#99f6e4',
   'Bicos e serviços incomuns: companhia, fila, mudança, montagem e mais. Só maiores de 18, sem contato físico íntimo.',
   'Sparkle', TRUE, 18)
ON CONFLICT (slug) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  min_age     = EXCLUDED.min_age,
  is_active   = TRUE,
  updated_at  = NOW();

DO $seed$
DECLARE
  v      RECORD;
  v_enx  INTEGER;
BEGIN
  SELECT id_machine INTO v_enx FROM public.tb_machine WHERE slug = 'fora_do_comum';
  FOR v IN
    SELECT * FROM (VALUES
      ('Amigo / companhia por hora',        'fora-do-comum-companhia-por-hora'),
      ('Acompanhante de idoso em consulta', 'fora-do-comum-acompanhante-de-idoso'),
      ('Guardador de lugar em fila',        'fora-do-comum-guardador-de-fila'),
      ('Passeador de pet',                  'fora-do-comum-passeador-de-pet'),
      ('Montador de móveis',                'fora-do-comum-montador-de-moveis'),
      ('Personal organizer',                'fora-do-comum-personal-organizer'),
      ('Cozinheiro para eventos',           'fora-do-comum-cozinheiro-para-eventos'),
      ('Ledor (leitura em voz alta)',       'fora-do-comum-ledor'),
      ('Ajudante de mudança',               'fora-do-comum-ajudante-de-mudanca'),
      ('Testador de produtos',              'fora-do-comum-testador-de-produtos')
    ) AS t(profession, slug)
  LOOP
    IF EXISTS (SELECT 1 FROM public.tb_category WHERE lower(profession_slug) = lower(v.slug)) THEN
      UPDATE public.tb_category
         SET desc_category = v.profession,
             id_machine    = v_enx,
             is_active     = TRUE,
             updated_at    = NOW()
       WHERE lower(profession_slug) = lower(v.slug);
    ELSE
      INSERT INTO public.tb_category (desc_category, id_machine, is_active, profession_slug)
      VALUES (v.profession, v_enx, TRUE, v.slug);
    END IF;
  END LOOP;
END
$seed$;

CREATE OR REPLACE FUNCTION fl_profile_category_min_age()
RETURNS TRIGGER AS $$
DECLARE
  v_min  INT;
  v_age  INT;
BEGIN
  IF NEW.id_category IS NULL OR NEW.id_user IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.id_category IS NOT DISTINCT FROM OLD.id_category THEN
    RETURN NEW;
  END IF;
  SELECT m.min_age INTO v_min
    FROM public.tb_category c
    JOIN public.tb_machine m ON m.id_machine = c.id_machine
   WHERE c.id_category = NEW.id_category;
  IF v_min IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT EXTRACT(YEAR FROM AGE(CURRENT_DATE, u.data_nascimento))::int INTO v_age
    FROM public.tb_user u WHERE u.id_user = NEW.id_user;
  IF v_age IS NULL OR v_age < v_min THEN
    RAISE EXCEPTION 'category_min_age:%', v_min USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profile_category_min_age ON public.tb_profile;
CREATE TRIGGER trg_profile_category_min_age
  BEFORE INSERT OR UPDATE OF id_category ON public.tb_profile
  FOR EACH ROW EXECUTE FUNCTION fl_profile_category_min_age();

-- ─── 5. Avisos do feed de boletos ───────────────────────────────────────────
-- SUPERSET da lista da mig 310, mesmo nome de constraint, NOT VALID como lá.
ALTER TABLE public.tb_notification
  DROP CONSTRAINT IF EXISTS tb_notification_type_chk;

ALTER TABLE public.tb_notification
  ADD CONSTRAINT tb_notification_type_chk
  CHECK (type IN (
    'like_received',
    'comment_received',
    'follow_received',
    'message_received',
    'supervised_message_received',
    'parental_permission_request',
    'product_request_new',
    'product_response_new',
    'product_sale',
    'course_sale',
    'booking_received',
    'service_response_received',
    'chamado_match',
    'affiliate_commission_released',
    'subscription_expiring',
    'premium_expiring',
    'manifestation_expiring',
    'live_started',
    'clan_invite',
    'clan_member_joined',
    'live_gift_received',
    'condo_claim_pending',
    'condo_claim_resolved',
    'condo_notice_received',
    'condo_poll_opened',
    'residence_claim_pending',
    'residence_recognized',
    'residence_contested',
    'residence_proof_requested',
    'residence_ended',
    'condo_family_request',
    'condo_dispute_opened',
    'condo_dispute_decided',
    'condo_proof_submitted',
    'whatsapp_quality_alert',
    'delivery_opened',
    'delivery_accepted',
    'delivery_delivered',
    'delivery_confirmed',
    'delivery_canceled',
    'listing_order_new',
    'listing_order_paid',
    'listing_order_confirmed',
    'listing_order_disputed',
    'listing_order_resolved',
    -- atendente de IA: a cota acabou (263)
    'ai_quota_reached',
    -- delivery por peso: chegou uma contraproposta (266)
    'delivery_proposal',
    -- mensalidade da academia paga pela Freelandoo (310)
    'academy_fee_paid',
    -- feed de boletos (338)
    'debt_bill_claimed',
    'debt_bill_confirmed',
    'debt_bill_reviewed',
    'debt_proof_rejected'
  )) NOT VALID;
