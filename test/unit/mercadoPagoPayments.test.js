// test/unit/mercadoPagoPayments.test.js
//
// A tradução Stripe↔Mercado Pago. É *unit* de propósito: tudo aqui é função
// pura ou função com a rede dublada (conversão de dinheiro, assinatura do
// webhook, montagem dos itens, apuração de tarifa, os objetos que os
// confirmadores recebem), então roda sem Postgres.
//
// O que estes testes seguram é a classe de erro mais cara da integração: a que
// NÃO levanta exceção. Centavo virando real na régua errada, tarifa do
// comprador descontada do vendedor, evento caindo no balde errado e a "session"
// reidratada com o id errado — todos produzem cobrança aceita e entrega
// silenciosamente errada.
const test = require("node:test");
const assert = require("node:assert");

const mp = require("../../src/integrations/payments/mercadoPagoClient");
const provider = require("../../src/integrations/payments/providers/mercadopago");
const { EVENT_KIND } = require("../../src/integrations/payments/contract");
const MPWebhook = require("../../src/services/MercadoPagoWebhookService");

// ─────────────────────────── DINHEIRO ───────────────────────────────────────
// O erro mais caro possível: a plataforma conta em CENTAVOS (inteiro), o
// Mercado Pago recebe REAIS (decimal). Mandar 1990 onde ele espera 19.90 cobra
// mil novecentos e noventa reais de alguém.

test("centavos viram reais com duas casas", () => {
  assert.strictEqual(mp.centsToReais(1990), 19.9);
  assert.strictEqual(mp.centsToReais(300), 3);
  assert.strictEqual(mp.centsToReais(1), 0.01);
  assert.strictEqual(mp.centsToReais(0), 0);
});

test("a cauda do ponto flutuante não escapa para o valor cobrado", () => {
  const v = mp.centsToReais(1990);
  assert.strictEqual(String(v), "19.9");
  // A volta tem que fechar exatamente, senão o webhook reidrata outro valor.
  assert.strictEqual(mp.reaisToCents(v), 1990);
});

test("ida e volta fecha na faixa inteira de centavos", () => {
  for (let c = 0; c <= 2000; c++) {
    assert.strictEqual(mp.reaisToCents(mp.centsToReais(c)), c, `quebrou em ${c}`);
  }
});

// ─────────────────── ASSINATURA DO WEBHOOK (o portão) ───────────────────────
// Sem ela a rota é um caixa aberto: bastaria postar um JSON com um id de
// intenção para levar o produto sem pagar.

const SECRET = "segredo-de-teste";

function signed({ dataId, requestId, ts = "1700000000", secret = SECRET }) {
  const crypto = require("crypto");
  const parts = [];
  if (dataId) parts.push(`id:${String(dataId).toLowerCase()}`);
  if (requestId) parts.push(`request-id:${requestId}`);
  parts.push(`ts:${ts}`);
  const manifest = `${parts.join(";")};`;
  const v1 = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

test("assinatura válida passa", () => {
  const xSignature = signed({ dataId: "123456", requestId: "req-1" });
  const r = mp.verifyWebhookSignature({
    xSignature,
    xRequestId: "req-1",
    dataId: "123456",
    secret: SECRET,
  });
  assert.strictEqual(r.ok, true);
});

test("o data.id entra em MINÚSCULAS — senão a notificação de ASSINATURA toma 401", () => {
  // Id de pagamento é numérico, então a diferença só aparece nos ids de
  // preapproval, que têm letras: o bug nasce parecendo "só assinatura falha".
  const xSignature = signed({ dataId: "2c938084726fca480172750000000000", requestId: "req-2" });
  const r = mp.verifyWebhookSignature({
    xSignature,
    xRequestId: "req-2",
    dataId: "2C938084726FCA480172750000000000",
    secret: SECRET,
  });
  assert.strictEqual(r.ok, true, "o maiúsculo tinha que ser normalizado antes do HMAC");
});

test("pedaço AUSENTE é OMITIDO do manifesto, não vira string vazia", () => {
  // Notificação sem data.id existe. Montar `id:;` produz um hash que nunca casa
  // e toda notificação legítima passaria a tomar 401.
  const xSignature = signed({ dataId: null, requestId: "req-3" });
  const r = mp.verifyWebhookSignature({
    xSignature,
    xRequestId: "req-3",
    dataId: "",
    secret: SECRET,
  });
  assert.strictEqual(r.ok, true);
});

test("assinatura de outro segredo é recusada", () => {
  const xSignature = signed({ dataId: "123", requestId: "r", secret: "outro-segredo" });
  const r = mp.verifyWebhookSignature({
    xSignature,
    xRequestId: "r",
    dataId: "123",
    secret: SECRET,
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "signature_mismatch");
});

test("corpo assinado para OUTRO recurso é recusado (não dá para reusar assinatura)", () => {
  const xSignature = signed({ dataId: "111", requestId: "r" });
  const r = mp.verifyWebhookSignature({
    xSignature,
    xRequestId: "r",
    dataId: "222",
    secret: SECRET,
  });
  assert.strictEqual(r.ok, false);
});

test("header malformado e segredo ausente são recusados COM MOTIVO", () => {
  assert.strictEqual(
    mp.verifyWebhookSignature({ xSignature: "lixo", xRequestId: "r", dataId: "1", secret: SECRET })
      .reason,
    "signature_malformed"
  );
  assert.strictEqual(
    mp.verifyWebhookSignature({ xSignature: signed({ dataId: "1" }), dataId: "1", secret: "" })
      .reason,
    "secret_not_configured"
  );
});

// ───────────────────── URL DE RETORNO E auto_return ─────────────────────────

test("o placeholder do Stripe é substituído pelo id da intenção", () => {
  const url = provider.resolveReturnUrl(
    "https://freelandoo.com.br/ok?session_id={CHECKOUT_SESSION_ID}",
    "intent-abc"
  );
  assert.strictEqual(url, "https://freelandoo.com.br/ok?session_id=intent-abc");
});

test("auto_return só com URL pública https — localhost RECUSARIA o checkout inteiro", () => {
  assert.strictEqual(provider.canAutoReturn("https://www.freelandoo.com.br/ok"), true);
  assert.strictEqual(provider.canAutoReturn("http://www.freelandoo.com.br/ok"), false);
  assert.strictEqual(provider.canAutoReturn("https://localhost:3000/ok"), false);
  assert.strictEqual(provider.canAutoReturn("https://127.0.0.1/ok"), false);
  assert.strictEqual(provider.canAutoReturn(""), false);
});

// ──────────────────────────── ITENS DA PÁGINA ───────────────────────────────

test("vários itens saem em LINHAS SEPARADAS, com preço UNITÁRIO", () => {
  const items = provider.buildItems({
    currency: "BRL",
    lineItems: [
      { name: "Produto", amount_cents: 20000, quantity: 1 },
      { name: "Frete", amount_cents: 1550, quantity: 1 },
    ],
  });
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].unit_price, 200);
  assert.strictEqual(items[1].unit_price, 15.5);
  assert.strictEqual(items[1].title, "Frete");
});

test("unit_price é UNITÁRIO — quantity 2 não pode cobrar o dobro do total", () => {
  const items = provider.buildItems({
    lineItems: [{ name: "Ingresso", amount_cents: 5000, quantity: 2 }],
  });
  assert.strictEqual(items[0].quantity, 2);
  assert.strictEqual(items[0].unit_price, 50);
});

test("sem lineItems cai num item só, com o nome do produto", () => {
  const items = provider.buildItems({ productName: "Polén", amount_cents: 990 });
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].unit_price, 9.9);
  assert.strictEqual(items[0].title, "Polén");
});

// ─────────────────────── A TARIFA REAL (sai do vendedor) ────────────────────

async function withPayment(payment, fn) {
  const original = mp.getPayment;
  mp.getPayment = async () => payment;
  try {
    return await fn();
  } finally {
    mp.getPayment = original;
  }
}

test("a tarifa sai de fee_details, em centavos", async () => {
  const r = await withPayment(
    {
      id: 999,
      transaction_amount: 200,
      fee_details: [{ type: "mercadopago_fee", amount: 1.98, fee_payer: "collector" }],
    },
    () => provider.getChargeFee("999")
  );
  assert.strictEqual(r.fee_cents, 198);
  assert.strictEqual(r.source, "mercadopago_fee");
  assert.strictEqual(r.charge_id, "999");
});

test("⚠️ tarifa paga pelo COMPRADOR não é descontada do vendedor", async () => {
  // Juros de parcelamento bancados pelo comprador aparecem em fee_details com
  // fee_payer 'payer'. Somá-los descontaria do vendedor uma tarifa que ele
  // nunca pagou — e ninguém perceberia, porque a conta continua fechando.
  const r = await withPayment(
    {
      id: 1,
      transaction_amount: 100,
      fee_details: [
        { type: "mercadopago_fee", amount: 0.99, fee_payer: "collector" },
        { type: "financing_fee", amount: 12.5, fee_payer: "payer" },
      ],
    },
    () => provider.getChargeFee("1")
  );
  assert.strictEqual(r.fee_cents, 99);
});

test("sem fee_details, cai no líquido recebido", async () => {
  const r = await withPayment(
    {
      id: 2,
      transaction_amount: 50,
      fee_details: [],
      transaction_details: { net_received_amount: 49.5 },
    },
    () => provider.getChargeFee("2")
  );
  assert.strictEqual(r.fee_cents, 50);
});

test("⚠️ não apurar devolve NULL, nunca ZERO", async () => {
  // Number(null) é ZERO. Sem o guard, uma cobrança sem net_received_amount
  // produziria "taxa = valor inteiro" e zeraria o repasse do vendedor; e zero
  // pagaria ao vendedor dinheiro que o gateway já retirou.
  const r = await withPayment(
    { id: 3, transaction_amount: 50, fee_details: [], transaction_details: {} },
    () => provider.getChargeFee("3")
  );
  assert.strictEqual(r.fee_cents, null);
  assert.strictEqual(r.source, null);
});

// ──────────────────── CRIAÇÃO: o que o contrato devolve ─────────────────────

test("o avulso devolve o id da INTENÇÃO e a preferência como provider_ref", async () => {
  const original = mp.createPreference;
  mp.createPreference = async () => ({ id: "pref_1", init_point: "https://mp/pay" });
  try {
    const s = await provider.createCheckout(
      { amount_cents: 300, productName: "Entrega", successUrl: "https://freelandoo.com.br/ok" },
      { intentId: "intent-1" }
    );
    // ⚠️ `id` é o da intenção: é ele que os ~20 confirmadores gravam como
    // stripe_session_id e por onde acham o pedido depois.
    assert.strictEqual(s.id, "intent-1");
    assert.strictEqual(s.provider_ref, "pref_1");
    assert.strictEqual(s.url, "https://mp/pay");
    // ⚠️ NULL na criação: o payment ainda não existe. Quem preenche é o webhook.
    assert.strictEqual(s.payment_intent, null);
  } finally {
    mp.createPreference = original;
  }
});

test("a assinatura devolve o preapproval em `subscription` (não o id da intenção)", async () => {
  const original = mp.createPreapproval;
  mp.createPreapproval = async () => ({ id: "preapp_1", init_point: "https://mp/sub" });
  try {
    const s = await provider.createCheckout(
      {
        amount_cents: 5000,
        recurring: true,
        productName: "Plano",
        customerEmail: "a@b.com",
        successUrl: "https://freelandoo.com.br/ok",
      },
      { intentId: "intent-2" }
    );
    assert.strictEqual(s.id, "intent-2");
    // Os 4 fluxos recorrentes gravam isto em `stripe_subscription_id` e é por
    // ele que procuram a linha depois. Passar o id da intenção aqui faria o
    // cancelamento não achar nada.
    assert.strictEqual(s.subscription, "preapp_1");
    assert.strictEqual(s.provider_ref, "preapp_1");
  } finally {
    mp.createPreapproval = original;
  }
});

test("assinatura sem e-mail do pagador é RECUSADA em voz alta", async () => {
  await assert.rejects(
    () =>
      provider.createCheckout(
        { amount_cents: 5000, recurring: true, successUrl: "https://freelandoo.com.br/ok" },
        { intentId: "intent-3" }
      ),
    /e-mail/i
  );
});

test("campo só-do-Stripe é recusado pelo contrato", () => {
  assert.deepStrictEqual([...provider.UNSUPPORTED_FIELDS].sort(), [
    "allowPromotionCodes",
    "promotionCode",
  ]);
});

// ───────────────────── O MAPA DE STATUS DO WEBHOOK ──────────────────────────

test("approved entrega; refunded e charged_back estornam", () => {
  assert.strictEqual(MPWebhook.kindOfPaymentStatus("approved"), EVENT_KIND.CHECKOUT_PAID);
  assert.strictEqual(MPWebhook.kindOfPaymentStatus("refunded"), EVENT_KIND.REFUNDED);
  assert.strictEqual(MPWebhook.kindOfPaymentStatus("charged_back"), EVENT_KIND.REFUNDED);
  assert.strictEqual(MPWebhook.kindOfPaymentStatus("cancelled"), EVENT_KIND.CHECKOUT_EXPIRED);
});

test("⚠️ `rejected` NÃO expira o pedido", () => {
  // No Mercado Pago `rejected` é uma TENTATIVA recusada (cartão negado) e a
  // preferência continua viva: a pessoa volta e paga com outro cartão. Tratar
  // como expiração cancelaria — e, na Loja, devolveria ao estoque — um pedido
  // que a pessoa está justamente tentando pagar.
  assert.strictEqual(MPWebhook.kindOfPaymentStatus("rejected"), EVENT_KIND.IGNORED);
  assert.strictEqual(MPWebhook.kindOfPaymentStatus("pending"), EVENT_KIND.IGNORED);
  assert.strictEqual(MPWebhook.kindOfPaymentStatus("in_process"), EVENT_KIND.IGNORED);
  assert.strictEqual(MPWebhook.kindOfPaymentStatus("authorized"), EVENT_KIND.IGNORED);
});

// ──────────────── A REIDRATAÇÃO (o que os confirmadores leem) ───────────────

test("a session reidratada carrega o id da INTENÇÃO e o payload como metadata", () => {
  const intent = {
    id_payment_intent: "intent-9",
    payload: { type: "community_delivery", id_delivery: "42" },
    id_user: "user-1",
    amount_cents: 300,
    currency: "BRL",
    provider_ref: "pref_9",
    provider_customer_id: null,
  };
  const s = MPWebhook.buildSessionLike(intent, { id: 777, transaction_amount: 3 });

  assert.strictEqual(s.id, "intent-9");
  assert.deepStrictEqual(s.metadata, intent.payload);
  assert.strictEqual(s.client_reference_id, "user-1");
  // ⚠️ O payment vira o `payment_intent` que os confirmadores gravam e que o
  // estorno recebe depois.
  assert.strictEqual(s.payment_intent, "777");
  assert.strictEqual(s.amount_total, 300);
  assert.strictEqual(s.payment_status, "paid");
});

test("o charge reidratado permite distinguir estorno TOTAL de PARCIAL", () => {
  // Um estorno parcial feito à mão no painel chega pelo mesmo evento. Sem o
  // valor real devolvido, ele cancelaria o pedido inteiro de quem recebeu só
  // uma parte de volta.
  const parcial = MPWebhook.buildChargeLike({
    id: 5,
    transaction_amount: 200,
    transaction_amount_refunded: 50,
  });
  assert.strictEqual(parcial.amount, 20000);
  assert.strictEqual(parcial.amount_refunded, 5000);

  const total = MPWebhook.buildChargeLike({ id: 6, transaction_amount: 200 });
  assert.strictEqual(total.amount_refunded, 20000);
});

test("o charge de assinatura carrega invoice E subscription", () => {
  // Sem eles, os três consumidores pediriam ao STRIPE uma fatura com id do
  // Mercado Pago, cairiam no catch e devolveriam "ignorado": dinheiro devolvido
  // e serviço ligado.
  const c = MPWebhook.buildChargeLike({ id: 7, transaction_amount: 50 }, {
    subscriptionId: "preapp_7",
  });
  assert.strictEqual(c.invoice, "7");
  assert.strictEqual(c.subscription, "preapp_7");
});

test("billing_reason separa a 1ª cobrança da renovação", () => {
  // É ele que o contador de apoiadores da vaquinha usa para não contar a mesma
  // pessoa de novo todo mês.
  const first = MPWebhook.buildInvoiceLike({ id_payment_intent: "i", payload: {} }, {
    paymentId: "1", subscriptionId: "s", amountReais: 50, firstCharge: true,
  });
  const cycle = MPWebhook.buildInvoiceLike({ id_payment_intent: "i", payload: {} }, {
    paymentId: "2", subscriptionId: "s", amountReais: 50, firstCharge: false,
  });
  assert.strictEqual(first.billing_reason, "subscription_create");
  assert.strictEqual(cycle.billing_reason, "subscription_cycle");
  assert.strictEqual(cycle.total, 5000);
});

test("a subscription reidratada usa o id DO GATEWAY, não o da intenção", () => {
  const s = MPWebhook.buildSubscriptionLike({ id: "preapp_x", status: "cancelled" });
  assert.strictEqual(s.id, "preapp_x");
  assert.strictEqual(s.provider, "mercadopago");
});

// ─────────────────────────── DEDUPE DO WEBHOOK ──────────────────────────────

test("a chave de dedupe é o id da NOTIFICAÇÃO, não o do recurso", () => {
  // payment.created e payment.updated do MESMO pagamento são dois avisos
  // legítimos e distintos (um deles é o que traz `approved`). Deduplicar pelo
  // id do pagamento engoliria o segundo e a entrega nunca aconteceria.
  const a = MPWebhook.eventKey({ id: "111", type: "payment", action: "payment.created", data: { id: "9" } });
  const b = MPWebhook.eventKey({ id: "222", type: "payment", action: "payment.updated", data: { id: "9" } });
  assert.notStrictEqual(a, b);
  assert.strictEqual(a, "mp:111");
});

test("sem id na notificação a chave é composta, em vez de recusar o evento", () => {
  const k = MPWebhook.eventKey({ type: "payment", action: "payment.updated", data: { id: "9" } });
  assert.strictEqual(k, "mp:payment:payment.updated:9");
});

// ─────────────────────── A JANELA DO CICLO (derivada) ───────────────────────

test("a janela do ciclo é DERIVADA de next_payment_date", async () => {
  const original = mp.getPreapproval;
  mp.getPreapproval = async () => ({
    id: "s1",
    next_payment_date: "2026-10-16T00:00:00.000-03:00",
    auto_recurring: { frequency: 1, frequency_type: "months" },
  });
  try {
    const { period_start, period_end } = await provider.getSubscriptionPeriod("s1");
    assert.ok(period_end instanceof Date);
    assert.strictEqual(period_end.toISOString().slice(0, 7), "2026-10");
    // Um mês antes do próximo vencimento.
    assert.strictEqual(period_start.toISOString().slice(0, 7), "2026-09");
  } finally {
    mp.getPreapproval = original;
  }
});

test("assinatura sem next_payment_date devolve janela nula, sem estourar", async () => {
  const original = mp.getPreapproval;
  mp.getPreapproval = async () => ({ id: "s2" });
  try {
    const r = await provider.getSubscriptionPeriod("s2");
    assert.deepStrictEqual(r, { period_start: null, period_end: null });
  } finally {
    mp.getPreapproval = original;
  }
});

// ───────────────────────────── O AMBIENTE ───────────────────────────────────

test("o ambiente é derivado do TOKEN, e token estranho não é 'produção'", () => {
  const original = process.env.MERCADOPAGO_ACCESS_TOKEN;
  try {
    process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-123";
    assert.strictEqual(mp.environment(), "sandbox");
    process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-123";
    assert.strictEqual(mp.environment(), "production");
    // ⚠️ Afirmar "produção" sobre um token que não se reconhece seria pior que
    // dizer "não sei" — é o que o diagnóstico de boot mostra.
    process.env.MERCADOPAGO_ACCESS_TOKEN = "lixo";
    assert.strictEqual(mp.environment(), "unknown");
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    assert.strictEqual(mp.environment(), null);
    assert.strictEqual(mp.isConfigured(), false);
  } finally {
    if (original === undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    else process.env.MERCADOPAGO_ACCESS_TOKEN = original;
  }
});

// ──────────────────── A PORTA DE SAÍDA ──────────────────────────────────────
// Cancelar é a única porta que não pode estar trancada (regra do WhatsApp 224 e
// da conta de jogo 220). O caso real: linhas antigas do banco apontam para um
// `stripe_subscription_id` de teste que nenhum gateway conhece — e, com o
// Stripe removido, elas passaram a ser roteadas para o Mercado Pago.

async function withCancel(impl, fn) {
  const original = mp.cancelPreapproval;
  mp.cancelPreapproval = impl;
  try {
    return await fn();
  } finally {
    mp.cancelPreapproval = original;
  }
}

test("⚠️ cancelar o que o gateway NÃO CONHECE é sucesso, não erro", async () => {
  // Reproduzido contra a API real antes de existir: o 404 subia até
  // `SubscriptionEndService`, que cai no ramo "não sei o ciclo, cancela agora"
  // e estoura ali — 500 na cara de quem acabou de pedir para sair.
  const err = new mp.MercadoPagoError("not found", 404);
  const r = await withCancel(
    () => Promise.reject(err),
    () => provider.cancelSubscription("sub_orfao_do_stripe")
  );
  assert.strictEqual(r.status, "cancelled");
  assert.strictEqual(r.already_gone, true);
});

test("⚠️ QUALQUER outro erro ainda ESTOURA — 'não sei' não pode virar 'cancelei'", async () => {
  // Responder "cancelado" sem ter certeza deixaria um cartão sendo debitado
  // todo mês. É o estrago que nunca aparece: ninguém reclama do acesso que
  // continuou funcionando.
  for (const code of [401, 429, 500]) {
    const err = new mp.MercadoPagoError("falhou", code);
    await assert.rejects(
      () =>
        withCancel(
          () => Promise.reject(err),
          () => provider.cancelSubscription("sub_qualquer")
        ),
      (e) => e.statusCode === code
    );
  }
});

test("cancelamento normal continua devolvendo o que o gateway respondeu", async () => {
  const r = await withCancel(
    (id) => Promise.resolve({ id, status: "cancelled" }),
    () => provider.cancelSubscription("2c93808")
  );
  assert.strictEqual(r.id, "2c93808");
  assert.strictEqual(r.already_gone, undefined);
});
