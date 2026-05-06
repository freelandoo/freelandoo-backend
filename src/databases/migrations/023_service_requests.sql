-- 023_service_requests.sql
-- Mural de Serviços: pedidos criados por users, respondidos por subperfis, com chat por par.

CREATE TABLE IF NOT EXISTS tb_service_request (
  id_request           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user              UUID NOT NULL REFERENCES tb_user(id_user),
  id_machine           INTEGER NOT NULL REFERENCES tb_machine(id_machine),
  id_category          INTEGER NOT NULL REFERENCES tb_category(id_category),
  estado               VARCHAR(2),
  municipio            VARCHAR(120),
  description          TEXT NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  id_response_chosen   UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fulfilled_at         TIMESTAMPTZ,
  canceled_at          TIMESTAMPTZ,
  CONSTRAINT tb_service_request_status_chk
    CHECK (status IN ('OPEN','FULFILLED','CANCELED'))
);

CREATE INDEX IF NOT EXISTS ix_tb_service_request_match
  ON tb_service_request (id_machine, id_category, status);
CREATE INDEX IF NOT EXISTS ix_tb_service_request_user
  ON tb_service_request (id_user, created_at DESC);

CREATE TABLE IF NOT EXISTS tb_service_request_response (
  id_response          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_request           UUID NOT NULL REFERENCES tb_service_request(id_request) ON DELETE CASCADE,
  id_profile           UUID NOT NULL REFERENCES tb_profile(id_profile),
  status               VARCHAR(24) NOT NULL DEFAULT 'PRO_ACCEPTED',
  pro_accepted_at      TIMESTAMPTZ,
  pro_rejected_at      TIMESTAMPTZ,
  user_rejected_at     TIMESTAMPTZ,
  finalized_at         TIMESTAMPTZ,
  pro_last_read_at     TIMESTAMPTZ,
  user_last_read_at    TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_service_request_response_uq UNIQUE (id_request, id_profile),
  CONSTRAINT tb_service_request_response_status_chk
    CHECK (status IN ('PRO_ACCEPTED','PRO_REJECTED','USER_REJECTED','FINALIZED','CLOSED_OTHER_WON'))
);

CREATE INDEX IF NOT EXISTS ix_tb_service_request_response_profile
  ON tb_service_request_response (id_profile, status);
CREATE INDEX IF NOT EXISTS ix_tb_service_request_response_request
  ON tb_service_request_response (id_request);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tb_service_request_response_chosen_fk'
  ) THEN
    ALTER TABLE tb_service_request
      ADD CONSTRAINT tb_service_request_response_chosen_fk
      FOREIGN KEY (id_response_chosen) REFERENCES tb_service_request_response(id_response);
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS tb_service_request_message (
  id_message           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_response          UUID NOT NULL REFERENCES tb_service_request_response(id_response) ON DELETE CASCADE,
  sender               VARCHAR(8) NOT NULL,
  content              TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_service_request_message_sender_chk CHECK (sender IN ('USER','PRO'))
);

CREATE INDEX IF NOT EXISTS ix_tb_service_request_message_response
  ON tb_service_request_message (id_response, created_at);

ALTER TABLE tb_profile ADD COLUMN IF NOT EXISTS mural_last_seen_at TIMESTAMPTZ;
