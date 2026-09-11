// test/unit/asaasPayments.test.js
//
// A tradução Stripe↔Asaas. É *unit* de propósito: tudo aqui é função pura
// (conversão de dinheiro, data, mapa de eventos, montagem dos objetos que os
// confirmadores recebem), então roda sem Postgres e sem rede.
//
// O que estes testes seguram é a classe de erro mais cara da integração: a que
// NÃO levanta exceção. Centavo virando real na régua errada, evento do Asaas
// caindo no balde errado, e a "session" reidratada com o id errado — os três
// produzem cobrança aceita e entrega silenciosamente errada.
const test = require("node:test");
const assert = require("node:assert");

const asaas = require("../../src/integrations/payments/asaasClient");
const asaasProvider = require("../../src/integrations/payments/providers/asaas");
const contract = require("../../src/integrations/payments/contract");
const AsaasWebhookService = require("../../src/services/AsaasWebhookService");

// ─────────────────────────── DINHEIRO ───────────────────────────────────────
// O erro mais caro possível: a plataforma conta em CENTAVOS (inteiro), o Asaas
// recebe REAIS (decimal). Mandar 1990 onde ele espera 19.90 cobra mil
// novecentos e noventa reais de alguém.

test("centavos viram reais com duas casas", () => {
  assert.strictEqual(asaas.centsToReais(1990), 19.9);
  assert.strictEqual(asaas.centsToReais(30000), 300);
  assert.strictEqual(asaas.centsToReais(1), 0.01);
  assert.strictEqual(asaas.centsToReais(0), 0);
});

test("a cauda do ponto flutuante não escapa para o valor cobrado", () => {
  // 1990/100 em binário dá 19.900000000000002 se não for arredondado. O Asaas
  // recusa (ou arredonda) valor com mais de duas casas.
  const v = asaas.centsToReais(1990);
  assert.strictEqual(String(v), "19.9");
  assert.ok(Number.isFinite(v));
  // A volta tem que fechar exatamente, senão o webhook reidrata outro valor.
  assert.strictEqual(asaas.reaisToCents(v), 1990);
});

test("ida e volta é estável para uma faixa larga de valores", () => {
  for (const cents of [1, 7, 99, 100, 555, 1990, 4999, 30000, 123456, 999999]) {
    assert.strictEqual(
      asaas.reaisToCents(asaas.centsToReais(cents)),
      cents,
      `quebrou em ${cents}`
    );
  }
});

test("reaisToCents arredonda em vez de truncar", () => {
  // 19.99 * 100 dá 1998.9999... em ponto flutuante; truncar cobraria 1 centavo
  // a menos e o total do pedido não fecharia com o que foi gravado.
  assert.strictEqual(asaas.reaisToCents(19.99), 1999);
  assert.strictEqual(asaas.reaisToCents(0.07), 7);
  assert.strictEqual(asaas.reaisToCents(null), 0);
});

// ─────────────────────────── VENCIMENTO ─────────────────────────────────────

test("a data de vencimento sai no formato do Asaas (YYYY-MM-DD)", () => {
  assert.match(asaas.dueDateFromNow(3), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(asaas.dueDateFromNow(0), /^\d{4}-\d{2}-\d{2}$/);
});

test("o vencimento anda para a frente, nunca para trás", () => {
  const hoje = asaas.dueDateFromNow(0);
  const depois = asaas.dueDateFromNow(5);
  assert.ok(depois > hoje, `${depois} deveria ser depois de ${hoje}`);
  // dia negativo é elevado a zero: cobrança nunca nasce vencida.
  assert.strictEqual(asaas.dueDateFromNow(-10), hoje);
});

// ─────────────────────── AMBIENTE: SANDBOX É O PADRÃO ───────────────────────

test("só a palavra inteira 'production' cobra de verdade", () => {
  const antes = process.env.ASAAS_ENV;
  try {
    for (const v of ["", "prod", "prd", "PRODUCTION_", "sandbox", undefined]) {
      if (v === undefined) delete process.env.ASAAS_ENV;
      else process.env.ASAAS_ENV = v;
      assert.strictEqual(asaas.environment(), "sandbox", `"${v}" deveria cair em sandbox`);
    }
    process.env.ASAAS_ENV = "production";
    assert.strictEqual(asaas.environment(), "production");
    process.env.ASAAS_ENV = "PRODUCTION";
    assert.strictEqual(asaas.environment(), "production", "maiúscula é a mesma palavra");
  } finally {
    if (antes === undefined) delete process.env.ASAAS_ENV;
    else process.env.ASAAS_ENV = antes;
  }
});

test("sem credencial o provedor se declara não configurado", () => {
  const antes = process.env.ASAAS_API_KEY;
  try {
    delete process.env.ASAAS_API_KEY;
    assert.strictEqual(asaas.config(), null);
    assert.strictEqual(asaas.isConfigured(), false);
  } finally {
    if (antes !== undefined) process.env.ASAAS_API_KEY = antes;
  }
});

// ──────────────────── CAMPOS QUE SÓ O STRIPE ENTENDE ────────────────────────

test("cupom mandado ao Asaas é RECUSADO, não ignorado", () => {
  // Ignorar cobraria o valor cheio de alguém que viu um desconto na tela.
  assert.throws(
    () => contract.assertNoUnsupportedFields(
      { promotionCode: "PROMO10" },
      contract.STRIPE_ONLY_FIELDS,
      "asaas"
    ),
    /promotionCode/
  );
});

test("allowPromotionCodes:false NÃO é recusado — é ausência de cupom", () => {
  // `false` significa "feche o campo de cupom", que é o padrão do Asaas.
  // Recusá-lo quebraria a ativação de perfil, que manda exatamente isso.
  assert.doesNotThrow(() =>
    contract.assertNoUnsupportedFields(
      { allowPromotionCodes: false, promotionCode: null },
      contract.STRIPE_ONLY_FIELDS,
      "asaas"
    )
  );
});

// ────────────────────────── URL DE RETORNO ──────────────────────────────────

test("o placeholder do Stripe é substituído pelo id da intenção", () => {
  // O Asaas não substitui nada: sem isto a pessoa voltaria para uma URL com a
  // chave literal `{CHECKOUT_SESSION_ID}` dentro.
  const url = asaasProvider.resolveReturnUrl(
    "https://x.com/ok?session_id={CHECKOUT_SESSION_ID}&p=1",
    "abc-123"
  );
  assert.strictEqual(url, "https://x.com/ok?session_id=abc-123&p=1");
  assert.ok(!url.includes("CHECKOUT_SESSION_ID"));
});

test("URL sem placeholder passa intacta", () => {
  assert.strictEqual(
    asaasProvider.resolveReturnUrl("https://x.com/ok", "abc"),
    "https://x.com/ok"
  );
  assert.strictEqual(asaasProvider.resolveReturnUrl(null, "abc"), undefined);
});

// ────────────────────────── DESCRIÇÃO DA FATURA ─────────────────────────────

test("o frete aparece discriminado na descrição da cobrança", () => {
  // A descrição é o ÚNICO lugar onde o comprador vê o frete separado na fatura
  // do Asaas — ele cobra um valor só, sem linhas.
  const d = asaasProvider.buildDescription({
    lineItems: [
      { name: "Caneca", amount_cents: 5000, quantity: 2 },
      { name: "Frete — Correios PAC", amount_cents: 1500, quantity: 1 },
    ],
  });
  assert.ok(d.includes("2x Caneca"), d);
  assert.ok(d.includes("Frete"), d);
});

test("descrição explícita vence o nome do produto", () => {
  const d = asaasProvider.buildDescription({
    description: "Reserva: 10/10/2026 às 14:00",
    productName: "Corte — Barbearia",
  });
  assert.strictEqual(d, "Reserva: 10/10/2026 às 14:00");
});

test("a descrição respeita o teto de 500 caracteres do Asaas", () => {
  const d = asaasProvider.buildDescription({ description: "x".repeat(900) });
  assert.strictEqual(d.length, 500);
});

// ─────────────────────── MAPA DE EVENTOS DO WEBHOOK ─────────────────────────

test("CONFIRMED e RECEIVED entregam os dois", () => {
  // CONFIRMED = o cliente pagou; RECEIVED = o dinheiro caiu. Num boleto isso
  // pode levar dias, e esperar o segundo deixaria quem pagou sem o produto.
  assert.strictEqual(AsaasWebhookService.kindOf("PAYMENT_CONFIRMED"), "checkout_paid");
  assert.strictEqual(AsaasWebhookService.kindOf("PAYMENT_RECEIVED"), "checkout_paid");
});

test("estorno, remoção e vencimento caem nos baldes certos", () => {
  assert.strictEqual(AsaasWebhookService.kindOf("PAYMENT_REFUNDED"), "refunded");
  assert.strictEqual(AsaasWebhookService.kindOf("PAYMENT_DELETED"), "checkout_expired");
  assert.strictEqual(AsaasWebhookService.kindOf("PAYMENT_OVERDUE"), "checkout_expired");
});

test("evento desconhecido é IGNORADO, nunca adivinhado", () => {
  // O Asaas manda ~30 tipos de evento. Adivinhar o que fazer com um
  // desconhecido é como uma entrega errada nasce.
  for (const e of ["PAYMENT_CHECKOUT_VIEWED", "PAYMENT_BANK_SLIP_VIEWED", "INVENTADO", "", null]) {
    assert.strictEqual(AsaasWebhookService.kindOf(e), "ignored", `${e} deveria ser ignorado`);
  }
});

test("chargeback NÃO é tratado como estorno — é lacuna conhecida dos dois", () => {
  // O Stripe hoje também não trata disputa. Inventar aqui uma reversão que o
  // outro provedor não faz criaria a divergência que a reidratação evita.
  assert.strictEqual(AsaasWebhookService.kindOf("PAYMENT_CHARGEBACK_REQUESTED"), "ignored");
});

// ──────────────── A REIDRATAÇÃO: O CORAÇÃO DA MIGRAÇÃO ──────────────────────

const INTENT = Object.freeze({
  id_payment_intent: "11111111-2222-3333-4444-555555555555",
  provider: "asaas",
  flow: "polen_purchase",
  id_user: "user-9",
  payload: { type: "polen_purchase", user_id: "user-9", product_id: "7", polens_amount: "500" },
  amount_cents: 1990,
  currency: "BRL",
  status: "created",
  provider_ref: "pay_123",
  provider_customer_id: "cus_000001",
});

test("a session reidratada usa o id da INTENÇÃO, não o do Asaas", () => {
  // Este é o ponto que faz os 18 confirmadores continuarem funcionando: é o id
  // da intenção que foi gravado como `stripe_session_id` na criação. Usar o id
  // do Asaas faria todos responderem "não encontrado" — pagamento cobrado e
  // sem entrega.
  const s = AsaasWebhookService.buildSessionLike(INTENT, { id: "pay_123", value: 19.9 });
  assert.strictEqual(s.id, INTENT.id_payment_intent);
  assert.notStrictEqual(s.id, "pay_123");
});

test("o metadata do Stripe é devolvido a partir do payload da intenção", () => {
  // No Asaas não existe metadata; o significado mora no nosso banco.
  const s = AsaasWebhookService.buildSessionLike(INTENT, { id: "pay_123", value: 19.9 });
  assert.deepStrictEqual(s.metadata, INTENT.payload);
  assert.strictEqual(s.metadata.type, "polen_purchase");
});

test("o papel do payment_intent do Stripe é da própria cobrança do Asaas", () => {
  const s = AsaasWebhookService.buildSessionLike(INTENT, { id: "pay_123", value: 19.9 });
  assert.strictEqual(s.payment_intent, "pay_123");
  assert.strictEqual(s.amount_total, 1990);
  assert.strictEqual(s.payment_status, "paid");
});

test("o valor vem da intenção, não do que o gateway devolveu", () => {
  // A intenção é a nossa verdade sobre quanto foi cobrado. Se o Asaas
  // devolvesse outro valor, confiar nele deixaria o pedido ser confirmado por
  // um preço que ninguém aprovou.
  const s = AsaasWebhookService.buildSessionLike(INTENT, { id: "pay_1", value: 999 });
  assert.strictEqual(s.amount_total, 1990);
});

test("cobrança de assinatura vira mode subscription", () => {
  const s = AsaasWebhookService.buildSessionLike(INTENT, {
    id: "pay_2", value: 19.9, subscription: "sub_abc",
  });
  assert.strictEqual(s.mode, "subscription");
  assert.strictEqual(s.subscription, "sub_abc");
});

test("a invoice da PRIMEIRA cobrança se declara subscription_create", () => {
  // É por `billing_reason` que o contador de apoiadores da vaquinha não conta a
  // mesma pessoa de novo todo mês.
  const first = AsaasWebhookService.buildInvoiceLike(
    INTENT, { id: "pay_3", value: 50, subscription: "sub_x" }, { firstCharge: true }
  );
  assert.strictEqual(first.billing_reason, "subscription_create");

  const renew = AsaasWebhookService.buildInvoiceLike(
    INTENT, { id: "pay_4", value: 50, subscription: "sub_x" }, { firstCharge: false }
  );
  assert.strictEqual(renew.billing_reason, "subscription_cycle");
  assert.strictEqual(renew.subscription, "sub_x");
  assert.strictEqual(renew.amount_paid, 5000);
});

test("o charge de estorno TOTAL fecha amount com amount_refunded", () => {
  // `isFullRefund` compara os dois: se não fecharem, o estorno é tratado como
  // parcial e o pedido não é revertido.
  const { isFullRefund } = require("../../src/utils/refunds");
  const c = AsaasWebhookService.buildChargeLike({ id: "pay_5", value: 19.9 });
  assert.strictEqual(c.amount, 1990);
  assert.strictEqual(c.amount_refunded, 1990);
  assert.strictEqual(c.payment_intent, "pay_5");
  assert.strictEqual(isFullRefund(c), true);
});

test("estorno PARCIAL do painel do Asaas não é tratado como total", () => {
  // Sem ler o `refundedValue` real, um estorno parcial feito à mão cancelaria o
  // pedido inteiro de quem recebeu só uma parte de volta.
  const { isFullRefund } = require("../../src/utils/refunds");
  const c = AsaasWebhookService.buildChargeLike({ id: "pay_6", value: 100, refundedValue: 30 });
  assert.strictEqual(c.amount, 10000);
  assert.strictEqual(c.amount_refunded, 3000);
  assert.strictEqual(isFullRefund(c), false);
});

// ───────────────── A2: O FIM DA ASSINATURA NO ASAAS ─────────────────────────

test("assinatura removida e inativada caem no MESMO balde", () => {
  // Para quem assinou, "foi desativada" e "foi removida" são a mesma notícia:
  // parou de ser cobrado, então para de ter acesso.
  assert.strictEqual(AsaasWebhookService.kindOf("SUBSCRIPTION_DELETED"), "subscription_ended");
  assert.strictEqual(AsaasWebhookService.kindOf("SUBSCRIPTION_INACTIVATED"), "subscription_ended");
});

test("eventos de assinatura que NÃO encerram nada seguem ignorados", () => {
  // SUBSCRIPTION_CREATED chega no mesmo endpoint. Tratá-lo como fim da
  // assinatura derrubaria o acesso no instante em que ela é criada.
  for (const e of ["SUBSCRIPTION_CREATED", "SUBSCRIPTION_UPDATED", "SUBSCRIPTION_SPLIT_DISABLED"]) {
    assert.strictEqual(AsaasWebhookService.kindOf(e), "ignored", `${e} deveria ser ignorado`);
  }
});

test("o subscription reidratado usa o id do ASAAS, não o da intenção", () => {
  // ⚠️ A REGRESSÃO QUE ESTE TESTE TRAVA: ao contrário da session (que carrega o
  // id da intenção), aqui o id tem que ser o da assinatura no Asaas — é ele que
  // os quatro fluxos gravaram em `stripe_subscription_id`. Trocar os dois faria
  // o cancelamento não encontrar linha nenhuma e não ter efeito, em silêncio.
  const sub = AsaasWebhookService.buildSubscriptionLike({
    id: "sub_asaas_123",
    status: "INACTIVE",
    externalReference: "intent-uuid-999",
    deleted: true,
  });
  assert.strictEqual(sub.id, "sub_asaas_123");
  assert.notStrictEqual(sub.id, "intent-uuid-999");
  assert.strictEqual(sub.object, "subscription");
  assert.strictEqual(sub.status, "INACTIVE");
});

// ─── O ROTEAMENTO: inadimplência × cobrança removida × fim da assinatura ─────
//
// Estes exercitam `dispatchEvent` com o banco e o confirmador DUBLADOS: o que
// se mede aqui é para ONDE cada evento vai, que é exatamente o que estava
// errado antes (a renovação vencida caía em `already_settled` e sumia).

const PaymentIntentStorage = require("../../src/storages/PaymentIntentStorage");
const StripeWebhookService = require("../../src/services/StripeWebhookService");

function withStubs(intent, run) {
  const orig = {
    getById: PaymentIntentStorage.getById,
    getByProviderRef: PaymentIntentStorage.getByProviderRef,
    setStatus: PaymentIntentStorage.setStatus,
    dispatchEvent: StripeWebhookService.dispatchEvent,
    fulfill: StripeWebhookService.fulfillCheckoutSession,
    expire: StripeWebhookService.expireCheckoutSession,
  };
  const seen = { dispatched: [], fulfilled: 0, expired: 0, status: null };

  PaymentIntentStorage.getById = async () => intent;
  PaymentIntentStorage.getByProviderRef = async () => intent;
  PaymentIntentStorage.setStatus = async (_c, _id, st) => { seen.status = st; };
  StripeWebhookService.dispatchEvent = async (e) => { seen.dispatched.push(e.type); };
  StripeWebhookService.fulfillCheckoutSession = async () => { seen.fulfilled++; };
  StripeWebhookService.expireCheckoutSession = async () => { seen.expired++; };

  return Promise.resolve(run(seen)).finally(() => {
    PaymentIntentStorage.getById = orig.getById;
    PaymentIntentStorage.getByProviderRef = orig.getByProviderRef;
    PaymentIntentStorage.setStatus = orig.setStatus;
    StripeWebhookService.dispatchEvent = orig.dispatchEvent;
    StripeWebhookService.fulfillCheckoutSession = orig.fulfill;
    StripeWebhookService.expireCheckoutSession = orig.expire;
  });
}

const PAID_INTENT = { id_payment_intent: "int-1", status: "paid", payload: {}, amount_cents: 5000, currency: "BRL" };
const NEW_INTENT = { id_payment_intent: "int-2", status: "created", payload: {}, amount_cents: 5000, currency: "BRL" };

test("mensalidade VENCIDA vira inadimplência, não cobrança expirada", async () => {
  // ⚠️ O FURO QUE ISTO FECHA: antes caía em `already_settled` e era descartada.
  // Quem parasse de pagar seguia com acesso, para sempre, sem uma linha de log.
  await withStubs(PAID_INTENT, async (seen) => {
    const r = await AsaasWebhookService.dispatchEvent({
      id: "evt_1",
      event: "PAYMENT_OVERDUE",
      payment: { id: "pay_1", value: 50, subscription: "sub_asaas_1" },
    });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(seen.dispatched, ["invoice.payment_failed"]);
    assert.strictEqual(seen.expired, 0, "não pode expirar um pedido já entregue");
  });
});

test("cobrança de renovação REMOVIDA não marca ninguém como caloteiro", async () => {
  // PAYMENT_DELETED numa renovação é quase sempre o lojista cancelando a
  // cobrança à mão. Tratá-la como falha marcaria `past_due` quem não deve nada.
  await withStubs(PAID_INTENT, async (seen) => {
    const r = await AsaasWebhookService.dispatchEvent({
      id: "evt_2",
      event: "PAYMENT_DELETED",
      payment: { id: "pay_2", value: 50, subscription: "sub_asaas_1" },
    });
    assert.strictEqual(r.ignored, true);
    assert.strictEqual(r.reason, "already_settled");
    assert.deepStrictEqual(seen.dispatched, []);
  });
});

test("a PRIMEIRA cobrança vencida ainda expira o pedido", async () => {
  // A assinatura que nunca chegou a ser paga continua sendo um checkout que
  // expirou — este caminho não pode ter sido levado junto pela mudança acima.
  await withStubs(NEW_INTENT, async (seen) => {
    const r = await AsaasWebhookService.dispatchEvent({
      id: "evt_3",
      event: "PAYMENT_OVERDUE",
      payment: { id: "pay_3", value: 50, subscription: "sub_asaas_2" },
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(seen.expired, 1);
    assert.strictEqual(seen.status, "expired");
  });
});

test("assinatura removida no Asaas chega ao cancelamento dos 4 fluxos", async () => {
  // O payload de assinatura NÃO tem `payment` — tem `subscription`. Antes, o
  // guard `!payment` engolia o evento e a assinatura seguia ativa aqui dentro.
  await withStubs(PAID_INTENT, async (seen) => {
    const r = await AsaasWebhookService.dispatchEvent({
      id: "evt_4",
      event: "SUBSCRIPTION_DELETED",
      subscription: { id: "sub_asaas_9", status: "INACTIVE", externalReference: "int-1", deleted: true },
    });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(seen.dispatched, ["customer.subscription.deleted"]);
    assert.strictEqual(seen.status, "canceled");
  });
});

test("evento de assinatura de OUTRA conta não mexe em nada nosso", async () => {
  // O Asaas manda evento de toda assinatura da conta, inclusive as criadas à
  // mão no painel. Sem intenção, é silêncio — nunca um 500 que faz o Asaas
  // re-tentar para sempre uma assinatura que não é nossa.
  await withStubs(null, async (seen) => {
    const r = await AsaasWebhookService.dispatchEvent({
      id: "evt_5",
      event: "SUBSCRIPTION_DELETED",
      subscription: { id: "sub_alheia", status: "ACTIVE" },
    });
    assert.strictEqual(r.ignored, true);
    assert.strictEqual(r.reason, "intent_not_found");
    assert.deepStrictEqual(seen.dispatched, []);
  });
});
