// A7 — as duas moedas (Gold e Verde Esmeralda), ponta a ponta no banco.
//
// Roda: TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/postgres npm run test:moedas
//
// Cria um banco NOVO no mesmo servidor, aplica as migrations até a 328, semeia
// carteiras e preços na unidade antiga (Pólens), aplica a 329+ e confere:
//   * redenominação ÷ 100 com arredondamento para CIMA e soma preservada;
//   * a 329 não divide duas vezes;
//   * Gold → Esmeralda (1:1.000) atômico e idempotente, sem caminho de volta;
//   * anúncio e nível pagam Esmeralda; manifestação e destaque em Esmeralda;
//   * cupom Gold 12 a cada R$ 10 (só Gold, só o dono, uma vez);
//   * teto diário do engajamento e estorno ao desfazer.
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const base = process.env.TEST_DATABASE_URL;
if (!base || !/127\.0\.0\.1|localhost/.test(base)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(1);
}
const dbName = `a7_${Date.now()}`;
const url = base.replace(/\/[^/?]*(\?|$)/, `/${dbName}$1`);

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

async function migrateUpTo(dir, last) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "a7mig-"));
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".sql")) continue;
    if (Number(f.slice(0, 3)) <= last) fs.copyFileSync(path.join(dir, f), path.join(tmp, f));
  }
  return tmp;
}

(async () => {
  const admin = new Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  process.env.DATABASE_URL = url;
  process.env.DATABASE_SSL = "false";
  const pool = require("../src/databases");
  const { runMigrations } = require("../src/migrations/runner");
  const MIG_DIR = path.join(__dirname, "../src/databases/migrations");

  const before = await migrateUpTo(MIG_DIR, 328);
  await runMigrations({ pool, dir: before });

  // ── semente na unidade ANTIGA ───────────────────────────────────────────
  async function mkUser(tag) {
    const { rows } = await pool.query(
      `INSERT INTO tb_user (nome, email, senha, username, ativo, data_nascimento)
       VALUES ($1, $2, 'x', $3, TRUE, '1990-01-01') RETURNING id_user`,
      [tag, `${tag}_${dbName}@ex.com`, `${tag}_${dbName}`.slice(0, 40)]
    );
    return rows[0].id_user;
  }
  const balances = [150, 0, 500, 1, 12345, 99];
  const users = [];
  for (let i = 0; i < balances.length; i++) {
    const id = await mkUser(`u${i}`);
    users.push(id);
    const w = await pool.query(
      `INSERT INTO polen_wallets (user_id, balance, lifetime_earned, lifetime_spent)
       VALUES ($1, $2, $2 + 250, 250) RETURNING id`,
      [id, balances[i]]
    );
    await pool.query(
      `INSERT INTO polen_transactions (user_id, wallet_id, type, amount, source, source_id)
       VALUES ($1, $2, 'admin_adjustment', $3, 'seed', $4)`,
      [id, w.rows[0].id, balances[i], `seed:${i}`]
    );
  }
  await pool.query(`INSERT INTO polen_products (name, price_cents, polens_amount, bonus_polens) VALUES ('P500', 500, 500, 0), ('P50k', 50000, 50000, 5000)`);
  const cat = await pool.query(`SELECT id FROM manifestation_categories LIMIT 1`);
  let catId = cat.rows[0]?.id;
  if (!catId) {
    catId = (await pool.query(`INSERT INTO manifestation_categories (name, slug) VALUES ('Teste', 'teste-a7') RETURNING id`)).rows[0].id;
  }
  const manif = await pool.query(
    `INSERT INTO manifestation_products (category_id, name, banner_url, tag_label, tag_color, price_cents, price_polens)
     VALUES ($1, 'A7 teste', 'https://x/y.png', 'A7', 'emerald', 500, 500) RETURNING id`,
    [catId]
  );
  await pool.query(`INSERT INTO tb_live_gift (name, emoji, color, animation, price_polens, sort_order) VALUES ('A7 gift', 'x', '#000', 'pulse', 5, 99)`);
  const sumBefore = balances.reduce((a, b) => a + b, 0);

  // ── a 329+ ───────────────────────────────────────────────────────────────
  await runMigrations({ pool, dir: MIG_DIR });

  await check("saldos ÷ 100 arredondados para cima", async () => {
    for (let i = 0; i < users.length; i++) {
      const { rows } = await pool.query(`SELECT balance FROM polen_wallets WHERE user_id = $1`, [users[i]]);
      assert.equal(rows[0].balance, Math.ceil(balances[i] / 100), `carteira ${i}`);
    }
  });

  await check("soma preservada (nunca perde, sobra < 1 Gold por carteira)", async () => {
    const { rows } = await pool.query(`SELECT SUM(balance)::int s, COUNT(*)::int n FROM polen_wallets WHERE user_id = ANY($1)`, [users]);
    assert.ok(rows[0].s * 100 >= sumBefore);
    assert.ok(rows[0].s * 100 - sumBefore < 100 * rows[0].n);
    console.log(`      soma antes ${sumBefore} Pólens → depois ${rows[0].s} Gold (${rows[0].n} carteiras)`);
  });

  await check("ledger: linha de abertura por carteira e unidade antiga marcada", async () => {
    const { rows } = await pool.query(
      `SELECT user_id, amount, metadata FROM polen_transactions WHERE type = 'redenomination' AND user_id = ANY($1)`,
      [users]
    );
    assert.equal(rows.length, users.length);
    for (const r of rows) {
      const i = users.indexOf(r.user_id);
      assert.equal(r.amount, Math.ceil(balances[i] / 100));
      assert.equal(Number(r.metadata.old_balance), balances[i]);
    }
    const old = await pool.query(`SELECT DISTINCT unit FROM polen_transactions WHERE source = 'seed'`);
    assert.deepEqual(old.rows.map((r) => r.unit), ["polen"]);
  });

  await check("preços em Gold (pacotes, manifestação, presente)", async () => {
    const p = await pool.query(`SELECT name, polens_amount, bonus_polens FROM polen_products ORDER BY price_cents`);
    assert.deepEqual(p.rows.map((r) => [r.polens_amount, r.bonus_polens]), [[5, 0], [500, 50]]);
    const m = await pool.query(`SELECT price_polens FROM manifestation_products WHERE id = $1`, [manif.rows[0].id]);
    assert.equal(m.rows[0].price_polens, 5);
    const g = await pool.query(`SELECT price_polens FROM tb_live_gift WHERE name = 'A7 gift'`);
    assert.equal(g.rows[0].price_polens, 1);
  });

  await check("a 329 re-executada não divide de novo", async () => {
    const sql = fs.readFileSync(path.join(MIG_DIR, "329_gold_redenomination.sql"), "utf8");
    await pool.query(sql);
    const { rows } = await pool.query(`SELECT balance FROM polen_wallets WHERE user_id = $1`, [users[4]]);
    assert.equal(rows[0].balance, 124);
  });

  const EmeraldService = require("../src/services/EmeraldService");
  const PolenService = require("../src/services/PolenService");
  const user = (i) => ({ id_user: users[i] });

  await check("Gold → Esmeralda 1:1.000, atômico e idempotente", async () => {
    const key = crypto.randomUUID();
    const r = await EmeraldService.convert(user(4), { gold: 10, key });
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.emerald, 10000);
    assert.equal(r.gold_wallet.balance, 114);
    assert.equal(r.emerald_wallet.balance, 10000);
    const again = await EmeraldService.convert(user(4), { gold: 10, key });
    assert.equal(again.replay, true);
    const w = await pool.query(`SELECT balance FROM polen_wallets WHERE user_id = $1`, [users[4]]);
    assert.equal(w.rows[0].balance, 114);
    const e = await pool.query(`SELECT balance FROM emerald_wallets WHERE user_id = $1`, [users[4]]);
    assert.equal(e.rows[0].balance, 10000);
  });

  await check("conversão sem saldo de Gold não mexe em nada", async () => {
    const r = await EmeraldService.convert(user(3), { gold: 5, key: crypto.randomUUID() });
    assert.equal(r.statusCode, 402);
    const e = await pool.query(`SELECT COALESCE(SUM(balance),0)::int s FROM emerald_wallets WHERE user_id = $1`, [users[3]]);
    assert.equal(e.rows[0].s, 0);
  });

  await check("Esmeralda → Gold não existe", async () => {
    for (const k of Object.getOwnPropertyNames(EmeraldService)) {
      assert.ok(!/gold/i.test(k) || k === "summary", `função inesperada ${k}`);
    }
    const routes = fs.readFileSync(path.join(__dirname, "../src/routes/polen.routes.js"), "utf8");
    assert.ok(!/to-gold|toGold|emerald\/convert/.test(routes));
  });

  await check("anúncio assistido paga Esmeralda (mesmo número)", async () => {
    const req = await PolenService.requestRewardedAd(user(1), { headers: {} });
    assert.equal(req.error, undefined, req.error);
    const done = await PolenService.completeRewardedAd(user(1), { reward_token: req.reward_token });
    assert.equal(done.currency, "emerald");
    assert.equal(done.emerald_wallet.balance, req.reward_amount);
    const g = await pool.query(`SELECT balance FROM polen_wallets WHERE user_id = $1`, [users[1]]);
    assert.equal(g.rows[0].balance, 0);
  });

  await check("subir de nível paga Esmeralda e não repete", async () => {
    const XpStorage = require("../src/storages/XpStorage");
    const fn = XpStorage.creditLevelUpPolens || XpStorage.default?.creditLevelUpPolens;
    await fn.call(XpStorage, pool, { user_id: users[2], id_profile: crypto.randomUUID(), old_level: 1, new_level: 3, per_level: 1000 });
    const e = await pool.query(`SELECT balance FROM emerald_wallets WHERE user_id = $1`, [users[2]]);
    assert.equal(e.rows[0].balance, 2000);
  });

  await check("manifestação paga em Esmeralda (Gold × 1.000)", async () => {
    await pool.query(`UPDATE polen_settings SET manifestation_min_xp_level = 0, manifestation_users_enabled = TRUE, is_active = TRUE`);
    const r = await (require("../src/services/ManifestationService")).checkoutWithPolens(user(4), { product_id: manif.rows[0].id, currency: "emerald" });
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.emerald_wallet.balance, 10000 - 5000);
    const g = await pool.query(`SELECT balance FROM polen_wallets WHERE user_id = $1`, [users[4]]);
    assert.equal(g.rows[0].balance, 114);
  });

  await check("destaque em Esmeralda com override e venda desligada", async () => {
    await pool.query(`UPDATE polen_settings SET emerald_price_clan_highlight = 1234, emerald_price_premium_highlight = 0`);
    const ok = await PolenService.spend(user(4), { product: "clan_highlight", currency: "emerald" });
    assert.equal(ok.error, undefined, ok.error);
    assert.equal(ok.emerald_wallet.balance, 5000 - 1234);
    const off = await PolenService.spend(user(4), { product: "premium_highlight", currency: "emerald" });
    assert.ok(off.error);
    const goldOnly = await PolenService.spend(user(4), { product: "post_boost", currency: "emerald" });
    assert.ok(goldOnly.error, "impulsionar é só Gold");
  });

  for (const extra of require("./helpers/moedasA7Extra").checks) {
    await check(extra.name, () => extra.fn({ pool, users, user, url }));
  }

  console.log(`\nmoedas A7: ${passed} ok`);
  await pool.end();
  process.exit(0);
})().catch(async (err) => {
  console.error("FALHOU:", err);
  process.exit(1);
});
