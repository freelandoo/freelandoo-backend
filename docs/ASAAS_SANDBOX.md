# Asaas — ligar o sandbox e migrar a cobrança

Como pôr os **18 fluxos de pagamento** da Freelandoo para cobrar pelo Asaas, começando
pelo sandbox. Nada aqui exige mudar código: a troca é por variável de ambiente.

---

## 1. O que já está pronto

| Peça | Onde |
|---|---|
| Intenção de pagamento (o que a cobrança SIGNIFICA) | mig 231 — `tb_payment_intent` |
| Cliente do Asaas por conta | mig 236 — `tb_user.asaas_customer_id` |
| Contrato dos provedores | `src/integrations/payments/contract.js` |
| Cliente HTTP | `src/integrations/payments/asaasClient.js` |
| Providers | `src/integrations/payments/providers/{stripe,asaas}.js` |
| Porta única de cobrança | `src/integrations/payments/index.js` (`PaymentGateway`) |
| Webhook | `POST /webhooks/asaas` → `AsaasWebhookService` |

Os ~20 pontos que criavam cobrança **já não falam com o Stripe**: todos chamam
`PaymentGateway.createCheckout(...)`.

---

## 2. Passo a passo (sandbox)

### 2.1 Conta e chave

1. Crie a conta em <https://sandbox.asaas.com>.
2. No painel: **Integrações → Gerar chave de API**.
3. Copie a chave (ela começa com `$aact_`).

### 2.2 Variáveis no Railway (backend)

```
ASAAS_API_KEY=$aact_...          # a chave do SANDBOX
ASAAS_ENV=sandbox
ASAAS_WEBHOOK_TOKEN=<valor longo e aleatório que VOCÊ inventa>
PAYMENT_PROVIDER=asaas
```

> ⚠️ **Enquanto `ASAAS_API_KEY` estiver vazia, a plataforma continua cobrando pelo
> Stripe**, mesmo com `PAYMENT_PROVIDER=asaas`. É proposital: pedir um provedor sem
> credencial deixaria os 18 fluxos sem conseguir cobrar, e o sintoma só apareceria
> no primeiro clique de compra.

### 2.3 Webhook

No painel do Asaas: **Integrações → Webhooks → Adicionar**.

| Campo | Valor |
|---|---|
| URL | `https://<seu-backend>/webhooks/asaas` |
| Token de autenticação | o **mesmo** valor de `ASAAS_WEBHOOK_TOKEN` |
| Versão da API | v3 |
| Eventos — **cobranças** | `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_REFUNDED`, `PAYMENT_DELETED`, `PAYMENT_OVERDUE` |
| Eventos — **assinaturas** | `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_INACTIVATED` |

> ⚠️ **Sem o token configurado a rota responde 503 e recusa tudo.** Um endpoint de
> webhook aberto credita Polén e ativa perfil para quem souber a URL.

> ⚠️ **OS EVENTOS DE ASSINATURA FICAM NUMA ABA SEPARADA DO PAINEL** ("eventos para
> assinaturas", ao lado de "eventos para cobranças"). Marcar só o grupo de
> cobranças — que é o caminho óbvio — deixa os **4 fluxos recorrentes** (Plano
> Negócio, mensalidade de comunidade, bolsa patrocínio e Atendimento IA) sem
> saber que a assinatura ACABOU: quem cancelar pelo painel do Asaas, ou tiver a
> assinatura desativada, segue com o acesso aqui dentro **para sempre**, e não
> há erro nenhum para investigar. O mesmo endpoint recebe os dois grupos.

### 2.4 Conferir

1. Faça uma compra qualquer (a Loja de Poléns é a mais simples).
2. Você deve cair na fatura do Asaas com Pix/boleto/cartão.
3. Pague pelo simulador do sandbox.
4. Confira que o produto foi entregue e que a linha em `tb_payment_intent`
   saiu de `created` para `paid`.

---

## 3. O que MUDA para quem usa

### 3.1 Assinaturas deixam de cobrar sozinhas (se não for cartão)

No Asaas **só o cartão cobra automaticamente**. Em Pix ou boleto, a assinatura
apenas **gera** a cobrança todo mês e o cliente precisa pagar cada uma.

Atinge os 4 fluxos recorrentes: `plan_subscription`, `community_membership`,
`vaquinha_sponsorship`, `atendimento_ia`.

Para manter o comportamento do Stripe, use `ASAAS_BILLING_TYPE=CREDIT_CARD`.

### 3.2 Cupom do Stripe não existe no Asaas

O provider **recusa em voz alta** quem mandar `promotionCode`. Desconto tem que ser
calculado no backend e embutido no valor — que é como a ativação de perfil já faz.

### 3.3 Cancelar assinatura é IMEDIATO

Não existe `cancel_at_period_end`. Quem depende de "vale até o fim do ciclo"
precisa guardar a data e só chamar o cancelamento quando ela chegar.

### 3.4 Todo pagador precisa de CPF

O Asaas exige `name` + `cpfCnpj` para criar o cliente. A mig 188 já tornou o CPF
obrigatório por conta, então isso está resolvido — mas uma conta sem CPF recebe
uma recusa explícita ("Cadastre seu CPF antes de pagar") em vez de um erro cru.

---

## 4. Voltar atrás

```
PAYMENT_PROVIDER=stripe
```

Volta tudo para o Stripe no próximo deploy. As cobranças **já feitas no Asaas
continuam sendo estornadas e canceladas no Asaas** — o provedor sai da intenção,
nunca do ambiente.

---

## 5. Ir para produção

1. Troque a chave pela de produção (`https://www.asaas.com` → Integrações).
2. `ASAAS_ENV=production`.
3. Refaça o webhook no painel de **produção** (é outro painel, outro token).
4. Confira a taxa contratada — ela não é a do Stripe, e o `processor_fee_cents`
   dos pedidos da Loja usa a régua do Stripe (ver pendências).

---

## 6. Pendências conhecidas

| # | O quê | Impacto |
|---|---|---|
| 1 | `processor_fee_cents` da Loja usa a taxa REAL só no Stripe (`balance_transaction.fee`). No Asaas o campo cai no fallback configurado. | A taxa registrada no pedido é estimada, não a cobrada. |
| 2 | Chargeback (`PAYMENT_CHARGEBACK_REQUESTED`) não reverte a entrega. | **Mesma lacuna que já existe no Stripe** (que também só trata `charge.refunded`). |
| 3 | `PAYMENT_OVERDUE` expira a pendência e libera estoque/slot. Um boleto pago DEPOIS do vencimento chega com o pedido já cancelado. | Trade-off: sem isso, estoque e horário de agenda ficariam presos para sempre. |
| 4 | Cupom/`promotion code` seguem Stripe-only (`CouponService`). | Cupom só funciona no Stripe. |
| 5 | Split de pagamento do Asaas não é usado; o repasse continua sendo o holdback interno. | Nenhum — é o modelo atual. |

---

## 7. Testes

```bash
npm run test:unit     # 142 casos (27 são da tradução Stripe↔Asaas)
npm run test:asaas    # 31 casos de SQL, em transação com ROLLBACK
```

> `test:asaas` **pode** apontar para produção porque não existe `COMMIT` nela — ela
> confere, no fim, que produção ficou intocada. Não acrescente `COMMIT`.
