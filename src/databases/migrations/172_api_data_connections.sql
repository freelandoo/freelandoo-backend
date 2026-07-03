-- =============================================================================
-- Migration 172: API de Dados (conexões externas somente-leitura)
-- =============================================================================
-- Reusa tb_api_connection (mig 171) discriminando o tipo de token pela coluna
-- `kind`:
--   'atendimento' → token flnd_atd_ que lê/responde mensagens (/ext/v1)
--   'data'        → token flnd_data_ que só LÊ dados do dono (/ext/v1/data)
-- Um token de um kind NÃO acessa as rotas do outro (guard requireConnectionKind).
-- Tokens de atendimento existentes recebem kind='atendimento' pelo DEFAULT.
-- Idempotente (IF NOT EXISTS / seed com ON CONFLICT DO NOTHING).
-- =============================================================================

BEGIN;

ALTER TABLE public.tb_api_connection
  ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'atendimento';

ALTER TABLE public.tb_api_connection
  DROP CONSTRAINT IF EXISTS tb_api_connection_kind_chk;
ALTER TABLE public.tb_api_connection
  ADD CONSTRAINT tb_api_connection_kind_chk CHECK (kind IN ('atendimento','data'));

-- Índice de contagem de ativos por (usuário, kind) — usado no limite de 3/kind.
CREATE INDEX IF NOT EXISTS idx_api_connection_user_kind_active
  ON public.tb_api_connection (id_user, kind)
  WHERE status = 'active';

INSERT INTO public.tb_feature_flag (flag_key, label, description)
VALUES (
  'data_api',
  'API de Dados',
  'Conexões externas somente-leitura: tokens de API pessoais (flnd_data_) gerados pelo usuário que permitem a um software de terceiro (ERP/BI/painel) LER dados da conta via /ext/v1/data — subperfis, comunidades, serviços, cursos, produtos, redes sociais, nível/XP e métricas de engajamento. NÃO expõe dados financeiros (saldo/ganhos/repasses) nem permite escrita. Desligar bloqueia as rotas /ext/v1/data (403) e esconde o botão de conexão. Tokens são preservados.'
)
ON CONFLICT (flag_key) DO NOTHING;

COMMIT;
