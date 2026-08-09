-- =============================================================================
-- Migration 203: Vínculo de morador, reconhecimento, contestação e comprovante
-- Subsistema 3 do desenho macro de comunidades territoriais
-- (docs/superpowers/specs/2026-08-09-comunidades-territoriais-design.md §7).
--
-- A pergunta que este subsistema responde é "quem mora aqui?", e a resposta
-- honesta do desenho (§6.2) é: NENHUMA fonte externa gratuita confirma que você
-- mora no número 123. O ViaCEP prova o ONDE (mig 202); as PESSOAS provam o
-- QUEM. Por isso o vínculo nasce com estado social, não com um booleano.
--
-- Os quatro degraus (§7):
--   unidade vazia            → reconhecido na hora (o caso comum, zero fricção)
--   unidade ocupada          → pendente; um co-morador reconhece → reconhecido
--   7 dias de silêncio       → morador NÃO RECONHECIDO (lê, não escreve)
--   um co-morador contesta   → divergência → decisão humana
--
-- INVARIANTE (§7.1): nenhum degrau remove morador existente automaticamente.
-- Isso INVERTE o comportamento do condomínio de hoje (mig 196), onde aprovar
-- uma reivindicação transfere a titularidade e o morador anterior perde a
-- unidade em silêncio (conflito E1 do desenho). Aqui a unidade é N:N: várias
-- pessoas moram na mesma casa porque isso é o normal, não a exceção.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

-- ─── 1. O vínculo morador ↔ unidade ─────────────────────────────────────────
-- N:N de propósito (D11 + §4.1): a unidade tem quantos moradores tiver.
--
-- `ended_at` nunca é apagado: é o rastro que a carência do subsistema 6 vai
-- consultar, e é o erro que o C7 registra na comunidade de hoje (o `leave` faz
-- DELETE e apaga a história).
CREATE TABLE IF NOT EXISTS public.tb_residence_member (
  id_residence   BIGSERIAL    PRIMARY KEY,
  id_unit        BIGINT       NOT NULL REFERENCES public.tb_residence_unit(id_unit) ON DELETE CASCADE,
  id_user        UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,

  status         VARCHAR(14)  NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'recognized', 'unrecognized', 'contested', 'ended')),

  -- D15: o menor NÃO reivindica residência — herda a do responsável. Quando
  -- preenchida, esta coluna diz de quem o vínculo deriva, e a revogação é em
  -- cascata (responsável deixa de morar ⇒ o menor sai junto).
  derived_from   UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,

  claimed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Prazo do degrau 2. Passou e ninguém falou nada: vira não-reconhecido.
  pending_until  TIMESTAMPTZ  NULL,
  recognized_at  TIMESTAMPTZ  NULL,
  recognized_by  UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,

  ended_at       TIMESTAMPTZ  NULL,
  ended_by       UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  -- O motivo importa: a carência do subsistema 6 trata quem foi EXPULSO
  -- diferente de quem SAIU sozinho, e mudança comprovada é válvula (D14).
  end_reason     VARCHAR(24)  NULL
                   CHECK (end_reason IN ('left', 'moved', 'removed', 'rejected',
                                         'admin', 'responsible_left')),

  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Um vínculo ATIVO por (unidade, pessoa). Parcial porque o histórico fica:
-- quem saiu e voltou tem duas linhas, e só a de agora ocupa o índice.
CREATE UNIQUE INDEX IF NOT EXISTS ux_residence_member_active
  ON public.tb_residence_member (id_unit, id_user)
  WHERE ended_at IS NULL;

-- Os co-moradores de uma unidade: quem pode reconhecer e quem é notificado.
CREATE INDEX IF NOT EXISTS idx_residence_member_unit_live
  ON public.tb_residence_member (id_unit)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_residence_member_user_live
  ON public.tb_residence_member (id_user)
  WHERE ended_at IS NULL;

-- O sweeper do degrau 2 varre por aqui.
CREATE INDEX IF NOT EXISTS idx_residence_member_pending
  ON public.tb_residence_member (pending_until)
  WHERE status = 'pending' AND ended_at IS NULL;

-- Cascata do D15: achar os menores que dependem de um responsável.
CREATE INDEX IF NOT EXISTS idx_residence_member_derived
  ON public.tb_residence_member (derived_from)
  WHERE derived_from IS NOT NULL AND ended_at IS NULL;

-- Estado e carimbos não podem divergir. Sem estes CHECKs, um bug de service
-- produziria "reconhecido sem data" — e o histórico deixaria de ser confiável
-- justamente onde ele é a única prova do que aconteceu.
ALTER TABLE public.tb_residence_member DROP CONSTRAINT IF EXISTS chk_residence_ended;
ALTER TABLE public.tb_residence_member ADD CONSTRAINT chk_residence_ended CHECK (
  (status = 'ended' AND ended_at IS NOT NULL AND end_reason IS NOT NULL) OR
  (status <> 'ended' AND ended_at IS NULL)
);

ALTER TABLE public.tb_residence_member DROP CONSTRAINT IF EXISTS chk_residence_recognized;
ALTER TABLE public.tb_residence_member ADD CONSTRAINT chk_residence_recognized CHECK (
  status <> 'recognized' OR recognized_at IS NOT NULL
);

-- ─── 2. Reconhecimento e contestação ────────────────────────────────────────
-- Um pronunciamento por vizinho por vínculo. `action` guarda o quê e `reason`
-- o porquê da contestação — que precisa ficar visível para quem decide (§7.3),
-- senão contestar vira arma sem custo.
CREATE TABLE IF NOT EXISTS public.tb_residence_review (
  id_review     BIGSERIAL    PRIMARY KEY,
  id_residence  BIGINT       NOT NULL REFERENCES public.tb_residence_member(id_residence) ON DELETE CASCADE,
  id_user       UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  action        VARCHAR(10)  NOT NULL CHECK (action IN ('recognize', 'contest')),
  reason        TEXT         NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Um voto por vizinho: quem já se pronunciou muda de ideia, não vota de novo.
CREATE UNIQUE INDEX IF NOT EXISTS ux_residence_review_voter
  ON public.tb_residence_review (id_residence, id_user);

CREATE INDEX IF NOT EXISTS idx_residence_review_residence
  ON public.tb_residence_review (id_residence);

-- Sinal `serial_contester` (§10): quem contesta muita gente.
CREATE INDEX IF NOT EXISTS idx_residence_review_contester
  ON public.tb_residence_review (id_user, created_at)
  WHERE action = 'contest';

-- ─── 3. Comprovante de residência ───────────────────────────────────────────
-- D13: quem lê o documento é o ADMIN DA PLATAFORMA, não o gestor. O gestor de
-- bairro é um vizinho; entregar a ele a conta de luz alheia transformaria a
-- governança local em coleta de documentos. O gestor vê só o veredito.
--
-- `purge_after` existe porque o arquivo é lixo tóxico depois da decisão: o R2
-- apaga em até 30 dias (§7.2) e só o veredito persiste.
CREATE TABLE IF NOT EXISTS public.tb_residence_proof (
  id_proof      BIGSERIAL    PRIMARY KEY,
  id_residence  BIGINT       NOT NULL REFERENCES public.tb_residence_member(id_residence) ON DELETE CASCADE,
  storage_key   TEXT         NOT NULL,
  status        VARCHAR(10)  NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by  UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  reviewed_by   UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ  NULL,
  verdict_note  TEXT         NULL,
  purge_after   TIMESTAMPTZ  NULL,
  purged_at     TIMESTAMPTZ  NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Um comprovante em análise por vínculo: reenviar substitui, não empilha.
CREATE UNIQUE INDEX IF NOT EXISTS ux_residence_proof_pending
  ON public.tb_residence_proof (id_residence)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_residence_proof_queue
  ON public.tb_residence_proof (status, created_at);

-- Fila do expurgo do R2.
CREATE INDEX IF NOT EXISTS idx_residence_proof_purge
  ON public.tb_residence_proof (purge_after)
  WHERE purged_at IS NULL AND purge_after IS NOT NULL;

-- ─── 4. Permissão parental (D15 / §7.4) ─────────────────────────────────────
-- Default FALSE, conservador como can_sell_courses: o menor pede, o responsável
-- libera pelo fluxo de notificação que já existe (mig 061).
ALTER TABLE public.minor_permissions
  ADD COLUMN IF NOT EXISTS can_join_territorial BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── 5. Tipos de notificação ────────────────────────────────────────────────
-- Reescrito como SUPERSET (regra da mig 153): a lista da 197 inteira, com os
-- tipos novos no FIM. O nome da constraint é `tb_notification_type_chk` — não
-- inventar um nome novo, senão o CHECK antigo continua valendo em paralelo e
-- passa a rejeitar exatamente o que o novo permite. NOT VALID de propósito:
-- linhas antigas não são revalidadas, só as novas passam pelo CHECK.
ALTER TABLE public.tb_notification
  DROP CONSTRAINT IF EXISTS tb_notification_type_chk;

ALTER TABLE public.tb_notification
  ADD CONSTRAINT tb_notification_type_chk
  CHECK (type IN (
    -- social (057)
    'like_received',
    'comment_received',
    'follow_received',
    'message_received',
    -- supervisão (062)
    'supervised_message_received',
    'parental_permission_request',
    -- pedidos de produto (071)
    'product_request_new',
    'product_response_new',
    -- comercial (152 / slice C)
    'product_sale',
    'course_sale',
    'booking_received',
    -- chamados / O.S. (slice D)
    'service_response_received',
    'chamado_match',
    -- financeiro (slice E)
    'affiliate_commission_released',
    'subscription_expiring',
    'premium_expiring',
    'manifestation_expiring',
    -- social extra (slice F)
    'live_started',
    'clan_invite',
    'clan_member_joined',
    'live_gift_received',
    -- condomínio (196/197)
    'condo_claim_pending',
    'condo_claim_resolved',
    'condo_notice_received',
    'condo_poll_opened',
    -- residência (203)
    'residence_claim_pending',
    'residence_recognized',
    'residence_contested',
    'residence_proof_requested',
    'residence_ended'
  )) NOT VALID;
