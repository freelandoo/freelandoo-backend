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

// ── Esmeralda por engajamento (slice 6) ─────────────────────────────────────
async function post(pool, ownerId) {
  const cat = (await pool.query(`SELECT id_category FROM tb_category ORDER BY id_category LIMIT 1`)).rows[0]?.id_category ?? null;
  let prof = (await pool.query(`SELECT id_profile FROM tb_profile WHERE id_user = $1 LIMIT 1`, [ownerId])).rows[0];
  if (!prof) {
    prof = (await pool.query(
      `INSERT INTO tb_profile (id_user, display_name, sub_profile_slug, id_category, is_user_account, is_visible, is_active)
       VALUES ($1, 'dono', $2, $3, TRUE, FALSE, TRUE) RETURNING id_profile`,
      [ownerId, `dono-${crypto.randomUUID().slice(0, 8)}`, cat]
    )).rows[0];
  }
  const r = await pool.query(
    `INSERT INTO tb_profile_portfolio_item (id_profile, feed_kind, description) VALUES ($1, 'recado', 'oi') RETURNING id_portfolio_item, id_profile`,
    [prof.id_profile]
  );
  return r.rows[0];
}
const emerald = async (pool, u) => Number((await pool.query(`SELECT COALESCE(SUM(balance),0) b FROM emerald_wallets WHERE user_id = $1`, [u])).rows[0].b);

add("engajamento: curtir rende 1, descurtir estorna, recurtir não paga de novo", async ({ pool, users }) => {
  const Ranking = require("../../src/storages/RankingStorage");
  const p = await post(pool, users[0]);
  const fan = users[2];
  const e0 = await emerald(pool, fan);
  const args = { id_portfolio_item: p.id_portfolio_item, id_profile: p.id_profile, id_user: fan };
  await Ranking.toggleLike(pool, args);
  assert.equal(await emerald(pool, fan), e0 + 1);
  await Ranking.toggleLike(pool, args);
  assert.equal(await emerald(pool, fan), e0);
  await Ranking.toggleLike(pool, args);
  assert.equal(await emerald(pool, fan), e0, "recurtir não paga");
});

add("engajamento: nada pelo próprio post", async ({ pool, users }) => {
  const Ranking = require("../../src/storages/RankingStorage");
  const p = await post(pool, users[0]);
  const e0 = await emerald(pool, users[0]);
  await Ranking.toggleLike(pool, { id_portfolio_item: p.id_portfolio_item, id_profile: p.id_profile, id_user: users[0] });
  assert.equal(await emerald(pool, users[0]), e0);
});

add("engajamento: salvar 2, comentar 3 só com 10+ caracteres, apagar estorna", async ({ pool, users }) => {
  const Reach = require("../../src/storages/ReachStorage");
  const p = await post(pool, users[0]);
  const fan = users[3];
  const e0 = await emerald(pool, fan);
  await Reach.inTx(pool, (c) => Reach.addWeighted(c, "post", p.id_portfolio_item, "save", 1, { actor: fan }));
  assert.equal(await emerald(pool, fan), e0 + 2);
  await Reach.inTx(pool, (c) => Reach.addWeighted(c, "post", p.id_portfolio_item, "comment", 1, { actor: fan, ref: "c1", chars: 4 }));
  assert.equal(await emerald(pool, fan), e0 + 2, "comentário curto não rende");
  await Reach.inTx(pool, (c) => Reach.addWeighted(c, "post", p.id_portfolio_item, "comment", 1, { actor: fan, ref: "c2", chars: 25 }));
  assert.equal(await emerald(pool, fan), e0 + 5);
  await Reach.inTx(pool, (c) => Reach.addWeighted(c, "post", p.id_portfolio_item, "comment", -1, { actor: fan, ref: "c2" }));
  assert.equal(await emerald(pool, fan), e0 + 2);
});

add("engajamento: dono ganha 1 a cada 10 pontos de alcance de outras contas", async ({ pool, users }) => {
  const Reach = require("../../src/storages/ReachStorage");
  const p = await post(pool, users[1]);
  const e0 = await emerald(pool, users[1]);
  // salvar = 30 pontos de alcance → 3 Esmeraldas ao dono
  await Reach.inTx(pool, (c) => Reach.addWeighted(c, "post", p.id_portfolio_item, "save", 1, { actor: users[2] }));
  assert.equal(await emerald(pool, users[1]), e0 + 3);
  // anônimo (sem conta) não conta
  await Reach.inTx(pool, (c) => Reach.recordUnique(c, "post", p.id_portfolio_item, { session_id: "anon-1" }, "share"));
  assert.equal(await emerald(pool, users[1]), e0 + 3);
});

add("engajamento: teto diário (500) somando ator e dono", async ({ pool, users }) => {
  const Reach = require("../../src/storages/ReachStorage");
  await pool.query(`UPDATE emerald_settings SET engagement_daily_cap = 4`);
  const fan = await (async () => {
    const r = await pool.query(`INSERT INTO tb_user (nome, email, senha, username, ativo, data_nascimento) VALUES ('cap', $1, 'x', $2, TRUE, '1990-01-01') RETURNING id_user`, [`cap${Date.now()}@ex.com`, `cap${Date.now()}`]);
    return r.rows[0].id_user;
  })();
  for (let i = 0; i < 4; i++) {
    const p = await post(pool, users[0]);
    await Reach.inTx(pool, (c) => Reach.addWeighted(c, "post", p.id_portfolio_item, "save", 1, { actor: fan }));
  }
  assert.equal(await emerald(pool, fan), 4, "2 + 2 e depois para no teto");
  await pool.query(`UPDATE emerald_settings SET engagement_daily_cap = 500`);
  const s = await pool.query(`SELECT engagement_daily_cap FROM emerald_settings`);
  assert.equal(s.rows[0].engagement_daily_cap, 500);
});

// A2-07: o teto era lido sem trava — salvar 10 posts EM PARALELO passava do teto.
add("engajamento: teto diário segura com ações em paralelo (A2-07)", async ({ pool, users }) => {
  const Reach = require("../../src/storages/ReachStorage");
  await pool.query(`UPDATE emerald_settings SET engagement_daily_cap = 4`);
  try {
    const r = await pool.query(`INSERT INTO tb_user (nome, email, senha, username, ativo, data_nascimento) VALUES ('capp', $1, 'x', $2, TRUE, '1990-01-01') RETURNING id_user`, [`capp${Date.now()}@ex.com`, `capp${Date.now()}`]);
    const fan = r.rows[0].id_user;
    // posts de DONOS diferentes: com o mesmo dono, a trava da carteira dele enfileirava tudo e escondia a corrida
    const posts = [];
    for (let i = 0; i < 10; i++) {
      const o = await pool.query(`INSERT INTO tb_user (nome, email, senha, username, ativo, data_nascimento) VALUES ('dono', $1, 'x', $2, TRUE, '1990-01-01') RETURNING id_user`, [`dono${i}${Date.now()}@ex.com`, `dono${i}${Date.now()}`]);
      posts.push(await post(pool, o.rows[0].id_user));
    }
    await Promise.all(posts.map((p) => Reach.inTx(pool, (c) => Reach.addWeighted(c, "post", p.id_portfolio_item, "save", 1, { actor: fan }))));
    assert.ok((await emerald(pool, fan)) <= 4, `passou do teto: ${await emerald(pool, fan)}`);
  } finally {
    await pool.query(`UPDATE emerald_settings SET engagement_daily_cap = 500`);
  }
});

// A2-07, prova determinística: duas transações abertas ao mesmo tempo. A 1ª credita (sem
// COMMIT); a 2ª entra e calcula o teto; aí a 1ª faz COMMIT. Sem trava, a 2ª lia o teto antigo
// e pagava de novo (teto 2, "salvar" vale 2 → 4).
add("engajamento: duas transações abertas não passam do teto (A2-07)", async ({ pool }) => {
  const EE = require("../../src/services/EngagementEmerald");
  await pool.query(`UPDATE emerald_settings SET engagement_daily_cap = 2`);
  const mk = async (n) => (await pool.query(`INSERT INTO tb_user (nome, email, senha, username, ativo, data_nascimento) VALUES ($3, $1, 'x', $2, TRUE, '1990-01-01') RETURNING id_user`, [`${n}${Date.now()}@ex.com`, `${n}${Date.now()}`, n])).rows[0].id_user;
  const c1 = await pool.connect();
  const c2 = await pool.connect();
  try {
    const fan = await mk("fan2tx");
    const p1 = await post(pool, await mk("donoa"));
    const p2 = await post(pool, await mk("donob"));
    await EE.actor(pool, { kind: "post", id: p1.id_portfolio_item, actor: fan, action: "save" }).catch(() => null); // cria a carteira
    await pool.query(`DELETE FROM emerald_transactions WHERE user_id = $1`, [fan]);
    const base = await emerald(pool, fan); // o saldo da carteira fica; o teto conta o que foi lançado hoje (zerado acima)
    await c1.query("BEGIN");
    await c2.query("BEGIN");
    await EE.actor(c1, { kind: "post", id: p1.id_portfolio_item, actor: fan, action: "save", ref: "t1" });
    const second = EE.actor(c2, { kind: "post", id: p2.id_portfolio_item, actor: fan, action: "save" });
    await new Promise((r) => setTimeout(r, 300));
    await c1.query("COMMIT");
    await second;
    await c2.query("COMMIT");
    const ganho = (await emerald(pool, fan)) - base;
    assert.ok(ganho <= 2, `passou do teto: ganhou ${ganho} (teto 2)`);
  } finally {
    await c1.query("ROLLBACK").catch(() => {});
    await c2.query("ROLLBACK").catch(() => {});
    c1.release();
    c2.release();
    await pool.query(`UPDATE emerald_settings SET engagement_daily_cap = 500`);
  }
});

// A2-07: a trava é do PAR em ordem fixa — A engajando em B enquanto B engaja em A não trava (deadlock).
add("engajamento: A e B um no outro ao mesmo tempo não dá deadlock", async ({ pool, users }) => {
  const Reach = require("../../src/storages/ReachStorage");
  const pa = [], pb = [];
  for (let i = 0; i < 8; i++) {
    pa.push(await post(pool, users[0]));
    pb.push(await post(pool, users[1]));
  }
  const jobs = [];
  for (let i = 0; i < 8; i++) {
    jobs.push(Reach.inTx(pool, (c) => Reach.addWeighted(c, "post", pb[i].id_portfolio_item, "like", 1, { actor: users[0] })));
    jobs.push(Reach.inTx(pool, (c) => Reach.addWeighted(c, "post", pa[i].id_portfolio_item, "like", 1, { actor: users[1] })));
  }
  const out = await Promise.allSettled(jobs);
  const bad = out.filter((x) => x.status === "rejected").map((x) => String(x.reason && x.reason.message));
  assert.equal(bad.length, 0, `falharam: ${bad.slice(0, 2).join(" | ")}`);
});

module.exports = { checks };
