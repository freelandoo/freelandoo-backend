-- =============================================================================
-- Migration 185: Clusters de Live (sala de comando de lives sincronizadas)
-- =============================================================================
-- O administrador cria um cluster, adiciona usuários (quantos quiser) e abre a
-- sala de comando. Os membros entram na página do cluster e ficam num lobby;
-- quando o admin aperta "Iniciar", TODOS os membros conectados iniciam a live
-- ao mesmo tempo (push via socket.io). O admin também dispara SINAIS — botões
-- grandes configuráveis (seed: START verde / STOP rosa / SIM verde / NÃO rosa)
-- e caixas de texto — que estampam a tela de todos os membros do cluster.
--
--   tb_live_cluster         -> o cluster (nome + status idle/started)
--   tb_live_cluster_member  -> usuários adicionados pelo admin
--   tb_live_cluster_button  -> botões de sinal configuráveis do cluster
--
-- Sinais NÃO são persistidos — são efêmeros (socket.io room cluster:<id>).
-- Idempotente (CREATE IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_live_cluster (
  id_live_cluster  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(80)  NOT NULL,
  status           VARCHAR(12)  NOT NULL DEFAULT 'idle',
  started_at       TIMESTAMPTZ,
  created_by       UUID REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tb_live_cluster
  DROP CONSTRAINT IF EXISTS tb_live_cluster_status_chk;
ALTER TABLE public.tb_live_cluster
  ADD CONSTRAINT tb_live_cluster_status_chk
  CHECK (status IN ('idle','started'));

CREATE TABLE IF NOT EXISTS public.tb_live_cluster_member (
  id_live_cluster  UUID NOT NULL REFERENCES public.tb_live_cluster(id_live_cluster) ON DELETE CASCADE,
  id_user          UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_live_cluster, id_user)
);

CREATE INDEX IF NOT EXISTS ix_live_cluster_member_user
  ON public.tb_live_cluster_member (id_user);

CREATE TABLE IF NOT EXISTS public.tb_live_cluster_button (
  id_button        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_live_cluster  UUID NOT NULL REFERENCES public.tb_live_cluster(id_live_cluster) ON DELETE CASCADE,
  label            VARCHAR(40)  NOT NULL,
  color            VARCHAR(16)  NOT NULL DEFAULT '#22c55e',
  sort_order       INTEGER      NOT NULL DEFAULT 0,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_live_cluster_button_cluster
  ON public.tb_live_cluster_button (id_live_cluster, is_active, sort_order);

-- Flag da superfície de membro (kill-switch; admin continua acessível).
INSERT INTO public.tb_feature_flag (flag_key, label, description)
VALUES (
  'live_clusters',
  'Clusters de Live',
  'Sala de comando de lives sincronizadas: página /cluster dos membros (lobby + início sincronizado + sinais do admin na tela). Desligar esconde a superfície do membro e bloqueia as rotas /live-clusters; o admin de clusters continua acessível.'
)
ON CONFLICT (flag_key) DO NOTHING;

COMMIT;
