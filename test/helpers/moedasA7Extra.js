// Casos do A7 que entram por slice (cupom, teto, Meu Mundo, engajamento).
const assert = require("node:assert/strict");
const crypto = require("crypto");

const checks = [];
const add = (name, fn) => checks.push({ name, fn });

// ── cupom Gold (slice 3) ────────────────────────────────────────────────────
add("cupom: 12 Gold a cada R$ 10, só com Gold", async ({ pool, users, user }) => {
  const Coupon = require("../../src/services/GoldCouponService");
  await pool.query(`UPDATE polen_wallets SET balance = 100 WHERE user_id = $1`, [users[5]]);
  const r = await Coupon.buy(user(5), { discount_cents: 2000, key: crypto.randomUUID() });
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.gold_cost, 24);
  assert.equal(r.wallet.balance, 76);
  assert.equal(r.coupon.discount_cents, 2000);
  const emerald = await Coupon.buy(user(5), { discount_cents: 1000, currency: "emerald" });
  assert.ok(emerald.error, "Esmeralda não compra cupom");
  const odd = await Coupon.buy(user(5), { discount_cents: 1500 });
  assert.ok(odd.error, "só múltiplos de R$ 10");
  const poor = await Coupon.buy(user(3), { discount_cents: 1000, key: crypto.randomUUID() });
  assert.equal(poor.statusCode, 402);
});

add("cupom: replay da mesma chave não cobra de novo", async ({ pool, users, user }) => {
  const Coupon = require("../../src/services/GoldCouponService");
  const key = crypto.randomUUID();
  const a = await Coupon.buy(user(5), { discount_cents: 1000, key });
  const b = await Coupon.buy(user(5), { discount_cents: 1000, key });
  assert.equal(b.replay, true);
  assert.equal(b.coupon.id, a.coupon.id);
  const w = await pool.query(`SELECT balance FROM polen_wallets WHERE user_id = $1`, [users[5]]);
  assert.equal(w.rows[0].balance, 76 - 12);
});

add("cupom: desconto na cobrança, uma compra por vez, resgate e liberação", async ({ users }) => {
  const Coupon = require("../../src/services/GoldCouponService");
  const { coupons } = await Coupon.listMine({ id_user: users[5] });
  const c = coupons.find((x) => x.discount_cents === 2000);
  const fake = (amount, meta) => Promise.resolve({ id: `sess_${crypto.randomUUID()}`, amount, meta });

  const first = await Coupon.charge({ user_id: users[5], couponId: c.id, amount_cents: 4990, flow: "function_purchase" }, fake);
  assert.equal(first.amount_cents, 2990);
  assert.equal(first.session.meta.gold_coupon_id, c.id);

  const second = await Coupon.charge({ user_id: users[5], couponId: c.id, amount_cents: 4990, flow: "premium" }, fake);
  assert.ok(second.error, "reservado para a primeira cobrança");

  const other = await Coupon.charge({ user_id: users[4], couponId: c.id, amount_cents: 4990, flow: "premium" }, fake);
  assert.ok(other.error, "cupom de outra pessoa");

  const gold = await Coupon.charge({ user_id: users[5], couponId: c.id, amount_cents: 4990, flow: "polen_purchase" }, fake);
  assert.ok(gold.error, "pacote de Gold não aceita cupom");

  await Coupon.release(c.id, first.session.id); // a cobrança expirou
  const third = await Coupon.charge({ user_id: users[5], couponId: c.id, amount_cents: 2500, flow: "manifestation" }, fake);
  assert.equal(third.amount_cents, 500);
  assert.ok(await Coupon.redeem(c.id, third.session.id));
  assert.equal(await Coupon.redeem(c.id, third.session.id), null, "resgate idempotente");
  const used = await Coupon.charge({ user_id: users[5], couponId: c.id, amount_cents: 4990, flow: "premium" }, fake);
  assert.ok(used.error, "cupom usado");

  const small = (await Coupon.listMine({ id_user: users[5] })).coupons.find((x) => x.status === "available");
  const tooBig = await Coupon.charge({ user_id: users[5], couponId: small.id, amount_cents: 1000, flow: "xp_boost" }, fake);
  assert.ok(tooBig.error, "cupom maior que a compra");
  const back = await Coupon.charge({ user_id: users[5], couponId: small.id, amount_cents: 1100, flow: "xp_boost" }, fake);
  assert.equal(back.amount_cents, 100, "a reserva do cupom grande demais foi solta");
});

add("cupom: caminhos antigos por código e afiliado não enxergam cupom Gold", async ({ pool, users }) => {
  const { rows } = await pool.query(`SELECT code, owner_user_id FROM tb_coupon WHERE gold_owner_user_id = $1 LIMIT 1`, [users[5]]);
  assert.equal(rows[0].owner_user_id, null, "sem dono afiliado = sem comissão");
  const CouponService = require("../../src/services/CouponService");
  await assert.rejects(() => CouponService.validateCoupon({ code: rows[0].code, order_value_cents: 5000 }));
  const Checkout = require("../../src/storages/CheckoutStorage");
  assert.equal(await Checkout.getCouponByCode(pool, rows[0].code), null);
});

module.exports = { checks };
