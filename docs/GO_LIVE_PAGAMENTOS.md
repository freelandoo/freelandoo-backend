# Go-Live de Pagamentos — Stripe (live mode) + Melhor Envio (produção)

> Estado do código em 2026-06-11: **nenhuma chave ou URL é hardcoded** — a troca
> test→live é 100% por variáveis de ambiente no Railway. Este doc lista o que
> é só env, o que o admin precisa fazer nos dashboards e os bloqueadores reais.

## 1. Stripe — test → live

### O que o código já garante

- `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` vêm do env (`StripeService.js`).
- Todos os checkouts usam `price_data` ad-hoc — **não existe Product/Price do
  dashboard para recriar em live**. Os `stripe_price_id/product_id` salvos em
  `tb_annual_fee_settings` (test mode) são legado não-usado em runtime; a
  ativação cobra `amount_cents` direto da settings.
- Cupons: `syncCouponToStripe` roda na criação do cupom → cupons novos criados
  pós-virada já nascem em live. Os IDs test dos cupons antigos são inertes
  (o desconto é calculado internamente via `CouponDiscountResolver`, nunca via
  promotion code no checkout).
- Webhook idempotente por `event.id` (`tb_stripe_webhook_event`).
- **Pix-ready**: `checkout.session.completed` com `payment_status=unpaid` é
  ignorado; a entrega acontece em `checkout.session.async_payment_succeeded`.

### Passos do admin (dashboard.stripe.com, modo LIVE)

1. Completar a ativação da conta (dados da empresa, banco) se ainda não estiver.
2. Pegar a **sk_live_...** em Developers → API keys.
3. Criar o webhook endpoint live: Developers → Webhooks → Add endpoint
   - URL: `https://<backend-railway>/webhooks/stripe`
   - Eventos: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`,
     `invoice.payment_succeeded`, `invoice.paid`, `invoice.payment_failed`,
     `customer.subscription.deleted`, `charge.refunded`
   - Copiar o **whsec_...** (é DIFERENTE do de test).
4. No Railway (serviço backend):
   - `STRIPE_SECRET_KEY=sk_live_...`
   - `STRIPE_WEBHOOK_SECRET=whsec_...` (o novo, do endpoint live)
5. Settings → Payment methods: conferir métodos ativos (cartão; Pix quando
   elegível — ver §2).
6. Smoke real: 1 compra de poléns de valor mínimo com cartão real + conferir
   webhook entregue (dashboard → Webhooks → o endpoint → logs) + reembolsar.

### Atenção

- A suite `npm run test:checkout` tem guard que **recusa sk_live** — continua
  rodando com a sk_test localmente; nada muda.
- O endpoint de webhook test pode ficar ativo no modo test sem conflito.

## 2. Pix na Stripe — SIM, é possível (com pré-requisitos)

- Pix é suportado para contas Stripe **do Brasil**, só **BRL**, só clientes no
  Brasil, via **API e Checkout** (que é exatamente o que usamos — Checkout
  hosted, sem `payment_method_types` hardcoded → quando o Pix for habilitado na
  conta, ele **aparece sozinho** no checkout, zero código).
- **Pré-requisito da Stripe**: conta em bom estado com **mínimo de ~60 dias de
  processamento** em live mode. Dá pra pedir avaliação antecipada via suporte.
  Habilitação em Settings → Payment methods quando elegível.
- Pagamento único (mode=payment) ✅ — todos os nossos fluxos são one-time.
  Recorrência exigiria "Pix Automático" (invite-only) — não usamos subscription
  mode em nenhum fluxo ativo.
- Reembolso via Pix ✅ (até 90 dias).
- O backend já está pronto para o ciclo assíncrono do Pix (QR pode expirar em
  ~4h; eventos async_payment_* tratados).

## 3. Melhor Envio — sandbox → produção

### O que o código já garante

- `src/integrations/melhorenvio/config.js`: `MELHOR_ENVIO_ENV=production` troca
  a base para `melhorenvio.com.br/api/v2` e passa a exigir
  `MELHOR_ENVIO_TOKEN`. Default (sem env) continua sandbox — dev local intacto.

### Passos do admin

1. Criar/ativar conta de PRODUÇÃO no melhorenvio.com.br (a do sandbox é
   separada) — dados da empresa, **saldo em carteira** (a plataforma paga as
   etiquetas do próprio saldo ME; sem saldo, o `checkout` da etiqueta falha).
2. Gerar o token no **Painel → Integrações → Área Dev → Cadastrar Aplicativo**
   (a API é OAuth2; o callback pode ser a URL do backend). Para o modelo do
   Freelandoo — **a plataforma é dona de UMA conta ME** que paga todas as
   etiquetas do próprio saldo — basta o token gerado para o próprio app/conta
   (JWT longo, ~1 ano, igual ao de sandbox que expira em 2027); **não** é
   preciso o fluxo 3-legged de autorização de terceiros. Escopos:
   `shipping-calculate`, `cart-read`, `cart-write`, `shipping-checkout`,
   `shipping-generate`, `shipping-print` (+ tracking).
3. No Railway:
   - `MELHOR_ENVIO_ENV=production`
   - `MELHOR_ENVIO_TOKEN=<token novo>`
   - (opcional) `MELHOR_ENVIO_CONTACT_EMAIL=...`
4. Anotar a data de expiração do token e rotacionar antes (sem refresh
   automático — o token é estático no env; ver `config.js`).
5. **Preflight antes da 1ª compra real**: chamar
   `GET /admin/payments/shipping-health` (admin) — confirma o ambiente
   (`production`), valida o token contra `/me`, mostra a conta ME autenticada
   e o **saldo da carteira**. Se `ok=false` ou saldo zerado, resolver antes de
   emitir etiqueta de verdade.

### CPF/CNPJ — RESOLVIDO (mig 164, 2026-06-16)

> Era o bloqueador desta seção. **Já está fechado no código.**

O ME de produção valida CPF/CNPJ de remetente e destinatário (o sandbox
aceitava `00000000000`). A coleta foi implementada:

- CPF/CNPJ do **vendedor** → `seller.origin_document` (perfil vendedor),
  passado em `ProfileProductOrderService.purchaseLabelForOrder`.
- CPF/CNPJ do **comprador** → coletado e validado no checkout da Loja
  (`buyer_document` em `tb_profile_product_order`); `purchaseLabel` já o usa.
- `purchaseLabel` ainda **falha cedo com mensagem clara** em produção se algum
  documento vier inválido (gravada em `markLabelFailure`, visível no admin),
  em vez de mandar placeholder e tomar erro opaco da API.

`npm run test:checkout` cobre o fluxo (22/22). Não há mais pré-requisito de
código para ligar `MELHOR_ENVIO_ENV=production` — só os passos de admin acima.

**Nota**: o cálculo de frete (cotação) nunca exigiu documentos.

## 4. Ordem sugerida de virada

1. Stripe live (cartão) — independente de tudo.
2. Feature CPF/CNPJ (vendedor + comprador) — slice próprio.
3. Melhor Envio produção (+ saldo na carteira ME).
4. Pix — automático quando a Stripe liberar (≥60 dias de live), só habilitar
   no dashboard.
