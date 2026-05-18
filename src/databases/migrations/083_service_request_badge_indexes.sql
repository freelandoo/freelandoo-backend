-- =============================================================================
-- Migration 083: índices para acelerar badge de service-requests
-- =============================================================================
-- As queries countUserUnreadChats / countProUnreadChats (ServiceRequestStorage)
-- estavam gerando seq scan em tb_service_request_message e timeout no proxy
-- Vercel (P75 > 5s). Esses índices cobrem os filtros mais usados.
-- Todos idempotentes.
-- =============================================================================

BEGIN;

-- Caminho do PRO: para uma response, pegar mensagens do USER posteriores ao
-- pro_last_read_at. O índice cobre o JOIN + filtro sender='USER' + created_at.
CREATE INDEX IF NOT EXISTS ix_srm_response_user_created
  ON public.tb_service_request_message (id_response, created_at)
  WHERE sender = 'USER';

-- Caminho do USER: mensagens do PRO posteriores ao user_last_read_at.
CREATE INDEX IF NOT EXISTS ix_srm_response_pro_created
  ON public.tb_service_request_message (id_response, created_at)
  WHERE sender = 'PRO';

-- Para filtrar responses pendentes de um user (status + last_read).
CREATE INDEX IF NOT EXISTS ix_srr_request_status_user
  ON public.tb_service_request_response (id_request, status, user_last_read_at);

-- Para filtrar responses pendentes do PRO (por id_profile + status).
CREATE INDEX IF NOT EXISTS ix_srr_profile_status_pro
  ON public.tb_service_request_response (id_profile, status, pro_last_read_at);

COMMIT;
