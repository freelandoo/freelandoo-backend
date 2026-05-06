-- 024_service_request_pending.sql
-- Adiciona status PENDING (chat aberto, sub-perfil ainda não decidiu) para
-- permitir conversa antes da confirmação. Expiração após 6h é feita via
-- DELETE lazy no app — sem nova coluna necessária (created_at já existe).

ALTER TABLE tb_service_request_response
  DROP CONSTRAINT IF EXISTS tb_service_request_response_status_chk;

ALTER TABLE tb_service_request_response
  ADD CONSTRAINT tb_service_request_response_status_chk
  CHECK (status IN ('PENDING','PRO_ACCEPTED','PRO_REJECTED','USER_REJECTED','FINALIZED','CLOSED_OTHER_WON'));
