-- 102_schema_migrations.sql
-- Tabela de controle do runner de migrations (frente 4 do hardening).
-- Puramente aditiva: CREATE TABLE IF NOT EXISTS.
--
-- Notas operacionais:
--  - O runner (run-migrations.js) também cria essa tabela inline, antes de
--    consultá-la, para que o primeiro boot funcione mesmo se a 102 ainda
--    não foi marcada como aplicada. Esta migration é a versão "oficial"
--    da tabela e fica registrada como qualquer outra.
--  - Em primeiro boot com schema_migrations vazia (caso atual em prod, já
--    com 101 migrations aplicadas há tempos), o runner faz bootstrap:
--    insere TODAS as migrations existentes como já aplicadas, sem rodar.
--  - A coluna `checksum` guarda SHA-256 do conteúdo do arquivo .sql na
--    hora em que foi aplicado. Re-executar com arquivo diferente é
--    detectado e ABORTA o boot — força a criação de nova migration ao
--    invés de editar histórica.

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename          TEXT        PRIMARY KEY,
  checksum          TEXT        NOT NULL,
  executed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  execution_time_ms INTEGER     NOT NULL DEFAULT 0,
  success           BOOLEAN     NOT NULL DEFAULT TRUE,
  error_message     TEXT
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_executed_at
  ON schema_migrations (executed_at DESC);
