-- =============================================================================
-- Migration 206: Disputa de unidade, comprovante em vídeo e a conversa dos três
-- Continuação do subsistema 5 (mig 205).
--
-- A mig 205 deu ao condomínio a unidade N:N. Esta dá o que fazer quando o
-- morador atual NÃO reconhece quem chegou.
--
-- Os dois caminhos, e por que o primeiro é o padrão:
--
--   ACEITAR COMO FAMÍLIA -> `recognize` (mig 203). Os dois moram. Fim. É o caso
--        comum — cônjuge, filho adulto, irmão, quem dividiu o aluguel — e
--        precisa custar UM clique, senão a plataforma trata família como fraude.
--
--   REJEITAR E COMPETIR  -> `contest` (mig 203) + a DISPUTA desta migration:
--        abre-se uma conversa de três (síndico + quem chegou + quem já está),
--        quem chegou filma o comprovante, o síndico decide.
--
-- A invariante do §7.1 continua de pé: nem a contestação nem a abertura da
-- disputa removem morador. Só o VEREDITO remove, e veredito é um humano
-- apertando um botão com o nome dele em `decided_by`.
--
-- Sobre quem lê o documento — decisão do Alex, 2026-08-29, e ela DIVERGE do
-- D13 de propósito. No bairro, o gestor é um vizinho, e por isso o comprovante
-- vai para o admin da plataforma. No condomínio, o líder é o SÍNDICO: papel
-- diferente, que já responde legalmente por quem entra no prédio. Então:
--   * o síndico assiste e decide;
--   * o admin da plataforma continua enxergando a fila (auditoria);
--   * o arquivo continua sendo lixo tóxico: `purge_after` expurga do R2.
-- O que NÃO acontece: o vídeo não vira mensagem no chat. Na conversa entra o
-- aviso de que o comprovante chegou; o arquivo mora aqui, com prazo de morte.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

-- ─── 1. Escopo de quem revisa o comprovante ─────────────────────────────────
-- A tb_residence_proof da mig 203 nasceu com um revisor só (o admin da
-- plataforma). Agora ela tem dois, e a coluna diz qual — em vez de o service
-- adivinhar pelo tipo da comunidade, que é como se constroem vazamentos.
ALTER TABLE public.tb_residence_proof
  ADD COLUMN IF NOT EXISTS reviewer_scope VARCHAR(16) NOT NULL DEFAULT 'platform',
  ADD COLUMN IF NOT EXISTS id_condo       UUID NULL
    REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  -- 'document' = foto/PDF (bairro, mig 203). 'video' = comprovante filmado,
  -- que é o que o condomínio pede: vídeo é muito mais caro de falsificar do
  -- que um print, e essa é a única razão de exigir filmagem.
  ADD COLUMN IF NOT EXISTS media_kind     VARCHAR(10) NOT NULL DEFAULT 'document';

ALTER TABLE public.tb_residence_proof DROP CONSTRAINT IF EXISTS chk_residence_proof_scope;
ALTER TABLE public.tb_residence_proof ADD CONSTRAINT chk_residence_proof_scope CHECK (
  reviewer_scope IN ('platform', 'condo_leader')
  AND (reviewer_scope <> 'condo_leader' OR id_condo IS NOT NULL)
);

ALTER TABLE public.tb_residence_proof DROP CONSTRAINT IF EXISTS chk_residence_proof_media;
ALTER TABLE public.tb_residence_proof ADD CONSTRAINT chk_residence_proof_media
  CHECK (media_kind IN ('document', 'video'));

-- Fila do síndico: os comprovantes pendentes do prédio dele.
CREATE INDEX IF NOT EXISTS idx_residence_proof_condo
  ON public.tb_residence_proof (id_condo, status, created_at)
  WHERE id_condo IS NOT NULL;

-- ─── 2. A disputa ───────────────────────────────────────────────────────────
-- Uma linha por contestação que virou disputa. Guarda os TRÊS lados e a
-- conversa, porque a conversa é a prova de que houve contraditório: quem foi
-- contestado vê a acusação e responde nela, em vez de ser removido por uma
-- decisão que aconteceu em algum painel onde ele não estava.
CREATE TABLE IF NOT EXISTS public.tb_condo_dispute (
  id_dispute      BIGSERIAL    PRIMARY KEY,
  id_condo        UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_unit         BIGINT       NOT NULL REFERENCES public.tb_residence_unit(id_unit) ON DELETE CASCADE,

  -- Quem chegou (o vínculo em disputa) e quem contestou.
  id_residence    BIGINT       NOT NULL REFERENCES public.tb_residence_member(id_residence) ON DELETE CASCADE,
  id_claimant     UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_contester    UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,

  -- A conversa dos três. SET NULL: apagar a conversa não pode apagar a disputa
  -- (a decisão é o que importa; o chat é o meio).
  id_conversation UUID         NULL REFERENCES public.tb_conversation(id_conversation) ON DELETE SET NULL,

  status          VARCHAR(12)  NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'approved', 'rejected', 'withdrawn')),
  reason          TEXT         NULL,

  -- Veredito: SEMPRE um humano. NULL enquanto aberta.
  decided_by      UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ  NULL,
  verdict_note    TEXT         NULL,

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Estado e carimbo não podem divergir (mesma disciplina da mig 203): disputa
-- decidida sem quem decidiu é um histórico que não serve de prova.
ALTER TABLE public.tb_condo_dispute DROP CONSTRAINT IF EXISTS chk_condo_dispute_decided;
ALTER TABLE public.tb_condo_dispute ADD CONSTRAINT chk_condo_dispute_decided CHECK (
  (status = 'open'      AND decided_at IS NULL AND decided_by IS NULL) OR
  (status = 'withdrawn' AND decided_at IS NOT NULL) OR
  (status IN ('approved', 'rejected') AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
);

-- Uma disputa ABERTA por vínculo: contestar de novo reabre a mesma conversa em
-- vez de empilhar três disputas sobre o mesmo apartamento (a mesma lição do
-- índice parcial da fila de fraude, mig 201).
CREATE UNIQUE INDEX IF NOT EXISTS ux_condo_dispute_open
  ON public.tb_condo_dispute (id_residence)
  WHERE status = 'open';

-- Painel do síndico.
CREATE INDEX IF NOT EXISTS idx_condo_dispute_queue
  ON public.tb_condo_dispute (id_condo, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_condo_dispute_unit
  ON public.tb_condo_dispute (id_unit);

-- Quem está envolvido: usado para decidir se alguém pode ver a disputa.
CREATE INDEX IF NOT EXISTS idx_condo_dispute_claimant
  ON public.tb_condo_dispute (id_claimant, created_at DESC);

-- ─── 3. Tipos de notificação ────────────────────────────────────────────────
-- SUPERSET (regra da mig 153): a lista INTEIRA da 204, com os novos no fim. O
-- nome da constraint é `tb_notification_type_chk` e não pode mudar — nome novo
-- deixaria o CHECK antigo valendo em paralelo, rejeitando exatamente o que o
-- novo permite. NOT VALID de propósito: linhas antigas não são revalidadas.
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
    -- condomínio (197)
    'condo_claim_pending',
    'condo_claim_resolved',
    'condo_notice_received',
    'condo_poll_opened',
    -- territorial (203)
    'residence_claim_pending',
    'residence_recognized',
    'residence_contested',
    'residence_proof_requested',
    'residence_ended',
    -- condomínio no núcleo territorial (206)
    'condo_family_request',
    'condo_dispute_opened',
    'condo_dispute_decided',
    'condo_proof_submitted'
  )) NOT VALID;
