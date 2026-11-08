// test/unit/meuMundoAffiliate.test.js
//
// A8 — afiliado de 10% pelo Meu Mundo. Roda sem Postgres: as storages do
// programa de afiliados são trocadas por dublês em memória e o "banco" é um
// cliente falso que responde só às consultas de pedido que a conversão faz.
//
// Cobre o que, errado, não dá sintoma:
//   • a % (10% da linha do tipo de compra, nunca a global legada de 25%);
//   • o que é venda do Meu Mundo (Gold do jogo sim; Gold da loja e Esmeralda não);
//   • autoindicação (mesmo usuário e mesmo CPF, no cupom e no vínculo);
//   • estorno desfaz a comissão (antes do saque REVERSED; depois, disputa).

const test = require("node:test");
const assert = require("node:assert");

const {
  MM_AFFILIATE_CONTEXT,
  isMeuMundoSale,
  meuMundoCommissionCents,
  isSelfReferral,
} = require("../../src/utils/meuMundoAffiliate");

const AffiliateStorage = require("../../src/storages/AffiliateStorage");
const AffiliateProgramStorage = require("../../src/storages/AffiliateProgramStorage");
const ReferralStorage = require("../../src/storages/ReferralStorage");
const XpStorage = require("../../src/storages/XpStorage");
const NotificationService = require("../../src/services/NotificationService");
const AffiliateConversionService = require("../../src/services/AffiliateConversionService");
const { cancelAffiliateOrder } = require("../../src/services/PolenProductService");
const pool = require("../../src/databases");

test.after(() => pool.end().catch(() => {}));

// ───────────────────────── regra pura ─────────────────────────

test("venda do Meu Mundo: Gold comprado no jogo e item em R$ do B4", () => {
  assert.equal(isMeuMundoSale({ type: "polen_purchase", return_to: "meu-mundo" }), true);
  assert.equal(isMeuMundoSale({ type: "qualquer_coisa_b4", meu_mundo: "1" }), true);
  // Gold comprado na Loja de Polén (fora do jogo) não é do Meu Mundo.
  assert.equal(isMeuMundoSale({ type: "polen_purchase" }), false);
  assert.equal(isMeuMundoSale({ type: "premium", return_to: "meu-mundo" }), false);
  assert.equal(isMeuMundoSale(null), false);
});

test("10% arredondado para baixo; nada sobre valor inválido", () => {
  assert.equal(meuMundoCommissionCents(1000, 10), 100);
  assert.equal(meuMundoCommissionCents(1999, 10), 199);
  assert.equal(meuMundoCommissionCents(5, 10), 0);
  assert.equal(meuMundoCommissionCents(0, 10), 0);
  assert.equal(meuMundoCommissionCents(-500, 10), 0);
  assert.equal(meuMundoCommissionCents("abc", 10), 0);
  assert.equal(meuMundoCommissionCents(1000, 0), 0);
  assert.equal(meuMundoCommissionCents(1000, 250), 1000); // nunca passa de 100%
  assert.equal(meuMundoCommissionCents(1000), 100); // padrão 10%
});

test("autoindicação: mesmo usuário ou mesmo CPF (com ou sem máscara)", () => {
  assert.equal(isSelfReferral({ buyerUserId: "u1", affiliateUserId: "u1" }), true);
  assert.equal(isSelfReferral({ buyerUserId: "u1", affiliateUserId: "u2", buyerCpf: "123.456.789-09", affiliateCpf: "12345678909" }), true);
  assert.equal(isSelfReferral({ buyerUserId: "u1", affiliateUserId: "u2", buyerCpf: "12345678909", affiliateCpf: "98765432100" }), false);
  assert.equal(isSelfReferral({ buyerUserId: "u1", affiliateUserId: "u2", buyerCpf: null, affiliateCpf: null }), false);
});

// ───────────────────────── conversão com dublês ─────────────────────────

const USERS = {
  padrinho: { id_user: "u-padrinho", cpf: "11111111111" },
  convidado: { id_user: "u-convidado", cpf: "22222222222" },
  gemeo: { id_user: "u-gemeo", cpf: "11111111111" }, // 2ª conta do padrinho
};
const AFFILIATE = { id_affiliate: "aff-1", id_user: USERS.padrinho.id_user, status: "ACTIVE" };
const COUPON = { id_coupon: "cp-1", code: "PADRINHO10", owner_user_id: USERS.padrinho.id_user, is_active: true, expires_at: null };

function setup({ ruleEnabled = true, rulePercent = 10 } = {}) {
  const db = { orders: [], orderCoupons: [], conversions: [], events: new Set() };
  const restore = [];
  const stub = (obj, name, fn) => {
    const orig = obj[name];
    obj[name] = fn;
    restore.push(() => { obj[name] = orig; });
  };

  stub(AffiliateProgramStorage, "getRule", async (_c, ctx) => (ctx === MM_AFFILIATE_CONTEXT
    ? { source_context: ctx, regime: "platform", is_enabled: ruleEnabled, percent: String(rulePercent), percent_source: "rule", creates_bond: true, min_order_cents: 0, max_pool_cents: null }
    : null));
  stub(AffiliateStorage, "getAffiliateById", async (_c, id) => (id === AFFILIATE.id_affiliate ? AFFILIATE : null));
  stub(AffiliateStorage, "getAffiliateByUserId", async (_c, id) => (id === AFFILIATE.id_user ? AFFILIATE : null));
  // Regra global LEGADA de 25%: o Meu Mundo não pode usá-la.
  stub(AffiliateStorage, "getEffectiveSettings", async () => ({ id_settings: "s-1", default_commission_percent: "25", commission_base: "NET", max_commission_cents: null, approval_delay_days: 0, holdback_days: 8, min_order_cents: 0 }));
  stub(AffiliateStorage, "getCouponOverride", async () => null);
  stub(AffiliateStorage, "getConversionByOrderId", async (_c, id) => db.conversions.find((c) => c.id_order === id) || null);
  stub(AffiliateStorage, "createConversion", async (_c, data) => {
    const row = { id_conversion: `cv-${db.conversions.length + 1}`, ...data };
    db.conversions.push(row);
    return row;
  });
  stub(AffiliateStorage, "recordConversionEvent", async (_c, data) => {
    const key = `${data.source}|${data.source_event_id}`;
    if (db.events.has(key)) return null;
    db.events.add(key);
    return { key };
  });
  stub(AffiliateStorage, "updateConversionStatus", async (_c, data) => {
    const row = db.conversions.find((c) => c.id_conversion === data.id_conversion);
    Object.assign(row, data);
    return row;
  });
  stub(ReferralStorage, "getUserCpf", async (_c, id) => Object.values(USERS).find((u) => u.id_user === id)?.cpf || null);
  stub(XpStorage, "getUserActiveProfileIds", async () => []);
  stub(NotificationService, "notifyAffiliateCommission", async () => {});

  const client = {
    async query(sql, params = []) {
      // cupom ativo do afiliado (conversão pelo vínculo)
      if (/JOIN tb_affiliate/i.test(sql)) return { rows: params[0] === AFFILIATE.id_affiliate ? [COUPON] : [] };
      if (/FROM tb_coupon/i.test(sql)) return { rows: params[0] === COUPON.code ? [COUPON] : [] };
      if (/FROM (public\.)?tb_order\b/i.test(sql) && /payment_provider_ref/i.test(sql)) {
        const ref = params[params.length - 1];
        return { rows: db.orders.filter((o) => o.payment_provider_ref === ref) };
      }
      if (/INSERT INTO tb_order \(/i.test(sql)) {
        const row = { id_order: `o-${db.orders.length + 1}`, id_user: params[0], total_cents: params[2], payment_provider: params[3], payment_provider_ref: params[4] };
        db.orders.push(row);
        return { rows: [row] };
      }
      if (/FROM tb_order_coupon/i.test(sql)) return { rows: db.orderCoupons.filter((c) => c.id_order === params[0]) };
      if (/INSERT INTO tb_order_coupon/i.test(sql)) {
        const row = { id_order_coupon: `oc-${db.orderCoupons.length + 1}`, id_coupon: params[0], id_order: params[1] };
        db.orderCoupons.push(row);
        return { rows: [row] };
      }
      throw new Error(`consulta inesperada no teste: ${sql.slice(0, 80)}`);
    },
  };
  return { db, client, done: () => restore.reverse().forEach((r) => r()) };
}

const buy = (client, over = {}) => AffiliateConversionService.createFromGenericPaidOrder(client, {
  coupon_code: COUPON.code,
  id_user_buyer: USERS.convidado.id_user,
  total_cents: 2990,
  source_context: MM_AFFILIATE_CONTEXT,
  payment_provider: "mercadopago",
  payment_provider_ref: "pi-sessao-1",
  ...over,
});

test("Gold do jogo pelo link: 10% para o padrinho (não os 25% legados)", async () => {
  const { db, client, done } = setup();
  try {
    const conv = await buy(client);
    assert.ok(conv, "a conversão nasce");
    assert.equal(conv.commission_cents, 299);
    assert.equal(Number(conv.commission_percent), 10);
    assert.equal(conv.commission_base_cents, 2990);
    assert.equal(conv.rule_snapshot.source_context, MM_AFFILIATE_CONTEXT);
    assert.equal(conv.status, "APPROVED"); // paga → aprovada, com holdback da regra global
    assert.ok(conv.holdback_until instanceof Date);
    // webhook at-least-once: a mesma cobrança não gera 2 comissões
    await buy(client);
    assert.equal(db.conversions.length, 1);
  } finally {
    done();
  }
});

test("pelo VÍNCULO (sem cupom na sessão) também paga 10%", async () => {
  const { client, done } = setup();
  try {
    const conv = await buy(client, { coupon_code: null, id_affiliate_resolved: AFFILIATE.id_affiliate, attribution_mode: "referral" });
    assert.equal(conv.commission_cents, 299);
  } finally {
    done();
  }
});

test("autoindicação: o próprio padrinho comprando não gera comissão", async () => {
  const { db, client, done } = setup();
  try {
    assert.equal(await buy(client, { id_user_buyer: USERS.padrinho.id_user }), null);
    assert.equal(await buy(client, { id_user_buyer: USERS.padrinho.id_user, coupon_code: null, id_affiliate_resolved: AFFILIATE.id_affiliate }), null);
    assert.equal(db.conversions.length, 0);
  } finally {
    done();
  }
});

test("autoindicação por CPF: segunda conta da mesma pessoa não gera comissão", async () => {
  const { db, client, done } = setup();
  try {
    assert.equal(await buy(client, { id_user_buyer: USERS.gemeo.id_user }), null);
    assert.equal(await buy(client, { id_user_buyer: USERS.gemeo.id_user, coupon_code: null, id_affiliate_resolved: AFFILIATE.id_affiliate }), null);
    assert.equal(db.conversions.length, 0);
  } finally {
    done();
  }
});

test("regra desligada pelo admin: nada", async () => {
  const { db, client, done } = setup({ ruleEnabled: false });
  try {
    assert.equal(await buy(client), null);
    assert.equal(db.conversions.length, 0);
  } finally {
    done();
  }
});

test("a % é a da linha do tipo de compra (admin muda sem código)", async () => {
  const { client, done } = setup({ rulePercent: 15 });
  try {
    const conv = await buy(client);
    assert.equal(conv.commission_cents, 448);
  } finally {
    done();
  }
});

test("estorno antes do saque: comissão REVERSED (e repetir o estorno não muda nada)", async () => {
  const { db, client, done } = setup();
  try {
    await buy(client);
    const purchase = { id: 7, stripe_session_id: "pi-sessao-1" };
    await cancelAffiliateOrder(client, purchase, { id: "ch-1", amount_refunded: 2990 });
    assert.equal(db.conversions[0].status, "REVERSED");
    await cancelAffiliateOrder(client, purchase, { id: "ch-1", amount_refunded: 2990 });
    assert.equal(db.conversions[0].status, "REVERSED");
  } finally {
    done();
  }
});

test("chargeback depois do saque: fica PAGA e marcada em disputa", async () => {
  const { db, client, done } = setup();
  try {
    await buy(client);
    db.conversions[0].status = "PAID";
    await cancelAffiliateOrder(client, { id: 8, stripe_session_id: "pi-sessao-1" }, { id: "ch-cb", amount_refunded: 2990 });
    assert.equal(db.conversions[0].status, "PAID");
    assert.equal(db.conversions[0].disputed, true);
  } finally {
    done();
  }
});

test("estorno de compra sem comissão: nada a fazer", async () => {
  const { client, done } = setup();
  try {
    assert.equal(await cancelAffiliateOrder(client, { id: 9, stripe_session_id: "outra" }, { id: "ch-x" }), null);
    assert.equal(await cancelAffiliateOrder(client, { id: 9 }, { id: "ch-x" }), null);
  } finally {
    done();
  }
});
