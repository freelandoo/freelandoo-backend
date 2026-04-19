# Migrations

Plain SQL, idempotent when possible. Apply in numeric order.

Run manually:

```bash
psql "$DATABASE_URL" -f src/databases/migrations/001_affiliate_core.sql
psql "$DATABASE_URL" -f src/databases/migrations/002_webhook_idempotency.sql
```

Each file is prefixed with a 3-digit number. Do not edit a file after it has
been applied in any environment — create a new one.
