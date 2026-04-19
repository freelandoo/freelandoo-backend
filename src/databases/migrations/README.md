# Migrations

Plain SQL, idempotent when possible. Apply in numeric order.

## Ordem de execução obrigatória

```bash
psql "$DATABASE_URL" -f src/databases/migrations/000_base_schema.sql
psql "$DATABASE_URL" -f src/databases/migrations/001_affiliate_core.sql
psql "$DATABASE_URL" -f src/databases/migrations/002_webhook_idempotency.sql
psql "$DATABASE_URL" -f src/databases/migrations/003_machines_taxonomy.sql
psql "$DATABASE_URL" -f src/databases/migrations/004_admin_audit_log.sql
psql "$DATABASE_URL" -f src/databases/migrations/005_coupon_discount_settings.sql
```

## Via Railway Shell (produção)

No painel do Railway, clique em **freelandoo-backend → Connect → Open Shell** e rode:

```bash
psql "$DATABASE_URL" -f src/databases/migrations/000_base_schema.sql
psql "$DATABASE_URL" -f src/databases/migrations/001_affiliate_core.sql
psql "$DATABASE_URL" -f src/databases/migrations/002_webhook_idempotency.sql
psql "$DATABASE_URL" -f src/databases/migrations/003_machines_taxonomy.sql
psql "$DATABASE_URL" -f src/databases/migrations/004_admin_audit_log.sql
psql "$DATABASE_URL" -f src/databases/migrations/005_coupon_discount_settings.sql
```

## Descrição dos arquivos

| Arquivo | Conteúdo |
|---------|----------|
| `000_base_schema.sql` | Tabelas core: usuários, perfis, itens, checkout, orders, pagamentos + seeds de referência |
| `001_affiliate_core.sql` | Programa de afiliados: afiliado, configurações, conversões, payouts, audit log |
| `002_webhook_idempotency.sql` | Idempotência de webhooks do Mercado Pago |
| `003_machines_taxonomy.sql` | Tabela tb_machine + seed das 8 máquinas + link de categorias |
| `004_admin_audit_log.sql` | Log de auditoria de ações admin |
| `005_coupon_discount_settings.sql` | Regras globais e overrides de desconto de cupons |

## Regras

- Não edite um arquivo depois de aplicado em qualquer ambiente — crie um novo.
- Todos os arquivos usam `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` — são seguros para rodar múltiplas vezes.
