# Mapa de dependências — `tb_order` × `payments` (F4.S2)

Levantamento pedido pelo plano-mestre (F4.S2): **mapear, não consolidar**.
A consolidação é projeto próprio; este doc é o pré-requisito dele.

Data: 2026-06-10 · método: grep por tabela em `src/` (fora de migrations).

## TL;DR

- **`tb_order` é a tabela viva** — todo o fluxo de assinatura/checkout Stripe
  e a atribuição de afiliado passam por ela (6 arquivos, lista abaixo).
- **`payments` está MORTA no código**: zero referências fora das migrations
  (`000_base_schema.sql` a criou pro PaymentController do Mercado Pago;
  `002_webhook_idempotency.sql` mexeu nela). O PaymentController foi deletado
  no MP-cleanup do hardening (2026-05-23). A tabela segue no banco apenas
  como **histórico de pagamentos MP antigos**.

## `tb_order` — quem usa o quê

| Arquivo | Papel |
|---------|-------|
| `storages/CheckoutStorage.js` | **Writer principal**: INSERT em `tb_order`, `tb_order_item`, `tb_order_coupon` na criação do checkout; UPDATE de status. |
| `services/StripeWebhookService.js` | Lê por `payment_provider='stripe' AND payment_provider_ref` (session/payment intent) pra confirmar/atualizar o pedido no webhook. |
| `storages/OrderStorage.js` | Leitura de pedidos (lista/detalhe) + UPDATE de status. |
| `services/AffiliateConversionService.js` | Atribuição genérica de afiliado: INSERT em `tb_order`/`tb_order_coupon` pra conversões fora da loja (cursos, polens, conveniência) e leitura pra comissões. |
| `storages/CouponSalesStorage.js` | Relatório de vendas com cupom: JOIN `tb_order`/`tb_order_item` (snapshot_name). |
| `storages/AffiliateStorage.js` | JOIN `tb_order` pra resolver comissões/cupom. |

Tabelas satélites: `tb_order_item`, `tb_order_coupon` — mesmas dependências
acima; nenhuma referência fora desses arquivos.

## `payments` — estado

- Referências no código: **nenhuma** (verificado 2026-06-10).
- Referências em migrations: `000_base_schema.sql` (CREATE), `002_webhook_idempotency.sql`.
- Conteúdo: registros históricos do fluxo Mercado Pago (descontinuado).

## Recomendação pra consolidação (quando virar projeto)

1. `payments` NÃO precisa ser consolidada — é só decidir o destino do
   histórico: exportar pra CSV/cold storage e dropar, ou manter como
   tabela-arquivo (custo ~zero). Não dropar sem exportar.
2. A consolidação real é unificar os *fluxos que não usam* `tb_order`
   (assinatura `tb_profile_subscription`, polens `polen_purchases`,
   premium, manifestação) numa visão única de receita — hoje cada um tem
   sua tabela e o admin financeiro agrega na mão (ver memória
   `project_freelandoo_admin_financeiro_reformulacao`).
3. Pré-requisito técnico: padronizar `payment_provider`/`payment_provider_ref`
   nesses fluxos do jeito que `tb_order` já faz, pra webhook idempotente único.
