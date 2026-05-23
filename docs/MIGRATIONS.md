# Migrations — guia operacional

<!-- canário 2026-05-23: validação do runner novo (lock + checksum + abort) em prod. -->


## Fluxo

1. Crie um arquivo numerado em `src/databases/migrations/`, ex:
   `103_descricao_curta.sql`.
2. Faça idempotente sempre — `CREATE TABLE IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`
   antes de `ADD CONSTRAINT`, etc.
3. Commit do .sql junto com o código que depende dele.

## Como roda

- **Deploy Railway** — `prestart` em `package.json` chama `node run-migrations.js`
  antes do `npm start`. Falha em qualquer migration aborta o boot (exit 1).
- **Local / staging manual** — `npm run migrate` ou `node migrate-remote.js`
  (apontando o `.env` para o banco alvo).
- **Inspeção** — `npm run migrate:status` lista cada arquivo como `applied`,
  `pending` ou `checksum_mismatch`.

## Como o runner se comporta

- Tabela `schema_migrations` (mig 102) registra `filename`, `checksum`,
  `executed_at`, `execution_time_ms`, `success`, `error_message`.
- `pg_advisory_lock` serializa execuções concorrentes (deploy simultâneo
  de duas instâncias não roda migrations em paralelo).
- Primeiro boot em banco já provisionado faz **bootstrap silencioso**:
  marca todas as migrations existentes como aplicadas sem re-rodar.
- Arquivo aplicado que muda de SHA-256 → `checksum_mismatch` e abort.
  Para corrigir uma migration antiga, **criar nova migration**, não editar.

## Reversão

Migrations são forward-only. Para reverter, crie uma migration nova com
o `DROP`/`ALTER` apropriado. Anote a referência no commit.

## Quando uma migration falha em produção

1. Logs do Railway mostram `migration.failed` com o nome e a mensagem.
2. App **não sobe** (exit 1 no prestart).
3. Decida:
   - Corrigir SQL → criar nova migration `NNN_fix_xyz.sql`.
   - Reverter manualmente o estado intermediário antes de tentar de novo
     (SQL ad-hoc; depois aplicar a versão corrigida).
4. Push novo commit → Railway redeploy → runner pula as `applied` e
   tenta só as pendentes.

## Não fazer

- Editar uma migration já aplicada — vai bater `checksum_mismatch` e
  abortar.
- Rodar SQL ad-hoc em prod sem registrar como migration — gera drift.
- Pular o `migrate:status` antes de um deploy crítico — pode esconder
  divergência entre arquivos e o que está no banco.
