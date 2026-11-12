// test/dinheiro-a2.e2e.js — Segurança A2 (dinheiro).
//
//   npm run test:dinheiro
//
// Pelo HTTP do app real (e por dentro dos serviços onde o caminho é o webhook),
// contra o Postgres LOCAL de teste (porta 55432). Nada de Mercado Pago de
// verdade: o cliente HTTP do provedor é trocado por um falso.
//
// Seções:
//   1. corrida: 20 conversões Gold→Esmeralda em paralelo debitam só o que há;
//      a mesma chave 20 vezes debita uma vez;
//   2. corrida: 20 compras de cupom Gold em paralelo — só as que o saldo paga;
//   3. valores: negativo, zero, fracionado, gigante, texto, moeda trocada;
//   4. anúncio premiado: 20 pedidos em paralelo respeitam o limite do dia;
//   5. webhook: pagamento aprovado com valor MENOR ou moeda trocada não entrega;
//   6. cobrança com cupom Gold vence antes da reserva do cupom;
//   7. compartilhamento: a marca do visitante é do servidor; o POST forjável caiu;
//   8. vitrine: anúncio vencido/rascunho não vende pelo id (A1-24).
const url = process.env.TEST_DATABASE_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DATABASE_SSL = "false";
process.env.JWT_SECRET = process.env.JWT_SECRET_TEST || "segredo-de-teste";
process.env.FRONTEND_URL = "https://freelandoo.test";
process.env.R2_PUBLIC_URL = "https://r2.test";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const jwt = require("jsonwebtoken");

let PASS = 0;
let FAIL = 0;
function check(label, cond, extra = "") {
  if (cond) {
    PASS++;
    console.log(`  ✓ ${label}`);
  } else {
    FAIL++;
    console.log(`  ✗ ${label}${extra ? " — " + extra : ""}`);
  }
}
const uid = () => crypto.randomBytes(4).toString("hex");

execFileSync(process.execPath, ["run-migrations.js"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env },
  stdio: "ignore",
});

const pool = require("../src/databases");
const mp = require("../src/integrations/payments/mercadoPagoClient");
const StripeWebhookService = require("../src/services/StripeWebhookService");
const MercadoPagoWebhookService = require("../src/services/MercadoPagoWebhookService");
const PaymentIntentStorage = require("../src/storages/PaymentIntentStorage");
const CommunityStorage = require("../src/storages/CommunityStorage");
const { EMERALD_PER_GOLD, couponGoldCost } = require("../src/utils/currency");
const app = require("../src/app");

let base;
async function call(method, p, { token, body, headers = {}, redirect = "follow" } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${p}`, { method, headers: h, body: payload, redirect });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _text: text };
  }
  return { status: res.status, body: json, location: res.headers.get("location") };
}

const users = [];
async function createUser() {
  const r = await pool.query(
    `INSERT INTO tb_user (nome, username, email, senha, data_nascimento, ativo)
     VALUES ($1,$2,$3,'$2b$10$abcdefghijklmnopqrstuuJ1aJ0aB2cD3eF4gH5iJ6kL7mN8oP9q','1990-01-01',TRUE)
     RETURNING id_user, email`,
    [`Conta ${uid()}`, `a2${uid()}`, `a2${uid()}@t.test`]
  );
  const p = await pool.query(
    `INSERT INTO tb_profile (id_user, id_category, display_name, sub_profile_slug, is_active, is_visible, is_user_account)
     VALUES ($1, (SELECT id_category FROM tb_category ORDER BY id_category LIMIT 1), 'Conta', $2, TRUE, TRUE, TRUE)
     RETURNING id_profile`,
    [r.rows[0].id_user, `conta-${uid()}`]
  );
  users.push(r.rows[0].id_user);
  return { ...r.rows[0], id_profile: p.rows[0].id_profile };
}
const tokenOf = (u) => jwt.sign({ id_user: u.id_user, email: u.email }, process.env.JWT_SECRET, { expiresIn: "1h" });
async function setGold(u, balance) {
  await pool.query(
    `INSERT INTO public.polen_wallets (user_id, balance, lifetime_earned) VALUES ($1, $2, $2)
     ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance`,
    [u.id_user, balance]
  );
}
const gold = async (u) =>
  Number((await pool.query(`SELECT balance FROM public.polen_wallets WHERE user_id = $1`, [u.id_user])).rows[0]?.balance ?? -1);
const emerald = async (u) =>
  Number((await pool.query(`SELECT balance FROM public.emerald_wallets WHERE user_id = $1`, [u.id_user])).rows[0]?.balance ?? 0);
const key = () => `k${crypto.randomBytes(8).toString("hex")}`;

(async () => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  const emeraldBefore = (await pool.query(`SELECT * FROM public.emerald_settings WHERE id = 1`)).rows[0];
  const polenBefore = (await pool.query(`SELECT * FROM public.polen_settings WHERE id = 1`)).rows[0];
  await pool.query(`UPDATE public.emerald_settings SET is_active = TRUE, conversion_enabled = TRUE WHERE id = 1`);

  try {
    // ═══ 1. corrida: conversão ═══════════════════════════════════════════
    console.log("\n━━━ 1. 20 conversões em paralelo ━━━");
    const A = await createUser();
    const tA = tokenOf(A);
    await setGold(A, 50);
    const rs = await Promise.all(
      Array.from({ length: 20 }, () => call("POST", "/polens/convert", { token: tA, body: { gold: 10, key: key() } }))
    );
    const ok = rs.filter((r) => r.status === 200).length;
    check("só 5 de 20 passam (saldo para 5)", ok === 5, `passaram ${ok}: ${[...new Set(rs.map((r) => r.status))]}`);
    check("Gold zerado, nunca negativo", (await gold(A)) === 0, `saldo ${await gold(A)}`);
    check("Esmeralda creditada = 5 conversões", (await emerald(A)) === 5 * 10 * EMERALD_PER_GOLD, `veio ${await emerald(A)}`);

    await setGold(A, 100);
    const same = key();
    await Promise.all(
      Array.from({ length: 20 }, () => call("POST", "/polens/convert", { token: tA, body: { gold: 10, key: same } }))
    );
    check("a mesma chave 20 vezes debita uma vez só", (await gold(A)) === 90, `saldo ${await gold(A)}`);
    const sumLedger = Number(
      (await pool.query(`SELECT COALESCE(SUM(amount),0)::int s FROM public.emerald_transactions WHERE user_id = $1 AND status = 'posted'`, [A.id_user])).rows[0].s
    );
    check("ledger de Esmeralda = saldo", sumLedger === (await emerald(A)), `ledger ${sumLedger} saldo ${await emerald(A)}`);

    // ═══ 2. corrida: cupom Gold ══════════════════════════════════════════
    console.log("\n━━━ 2. 20 compras de cupom em paralelo ━━━");
    const B = await createUser();
    const tB = tokenOf(B);
    const per10 = Number(emeraldBefore?.coupon_gold_per_10_brl) || 12;
    const cost = couponGoldCost(1000, per10);
    await setGold(B, cost * 2);
    const cs = await Promise.all(
      Array.from({ length: 20 }, () => call("POST", "/polens/coupons", { token: tB, body: { discount_cents: 1000, key: key() } }))
    );
    const okC = cs.filter((r) => r.status === 200 || r.status === 201).length;
    const nCoupons = Number((await pool.query(`SELECT COUNT(*)::int n FROM public.tb_coupon WHERE gold_owner_user_id = $1`, [B.id_user])).rows[0].n);
    check("só 2 cupons nascem (saldo para 2)", okC === 2 && nCoupons === 2, `ok ${okC}, cupons ${nCoupons}`);
    check("Gold do comprador zerado", (await gold(B)) === 0, `saldo ${await gold(B)}`);

    // ═══ 3. valores ══════════════════════════════════════════════════════
    console.log("\n━━━ 3. valores tortos ━━━");
    await setGold(A, 100);
    for (const g of [-5, 0, 1.5, 1e12, "abc", null, "10; DROP"]) {
      const r = await call("POST", "/polens/convert", { token: tA, body: { gold: g, key: key() } });
      check(`converter gold=${JSON.stringify(g)} é recusado`, r.status >= 400, `veio ${r.status}`);
    }
    check("saldo intacto depois dos valores tortos", (await gold(A)) === 100, `saldo ${await gold(A)}`);
    await setGold(B, 100000);
    for (const [d, cur] of [[-1000, undefined], [0, undefined], [1500, undefined], [1e9, undefined], [1000, "emerald"]]) {
      const r = await call("POST", "/polens/coupons", { token: tB, body: { discount_cents: d, currency: cur, key: key() } });
      check(`cupom discount=${JSON.stringify(d)} moeda=${cur || "gold"} é recusado`, r.status >= 400, `veio ${r.status}`);
    }
    check("nenhum cupom a mais", Number((await pool.query(`SELECT COUNT(*)::int n FROM public.tb_coupon WHERE gold_owner_user_id = $1`, [B.id_user])).rows[0].n) === 2);

    // ═══ 4. anúncio premiado ═════════════════════════════════════════════
    console.log("\n━━━ 4. anúncio premiado: 20 pedidos em paralelo ━━━");
    await pool.query(
      `UPDATE public.polen_settings SET is_active = TRUE, ads_per_day_per_user = 3, cooldown_seconds = 0,
              daily_polens_limit = GREATEST(daily_polens_limit, 1000), polens_per_ad = GREATEST(polens_per_ad, 1) WHERE id = 1`
    );
    const C = await createUser();
    const tC = tokenOf(C);
    const reqs = await Promise.all(
      Array.from({ length: 20 }, () => call("POST", "/polens/rewarded-ad/request", { token: tC, body: {} }))
    );
    const tokens = reqs.map((r) => r.body?.reward_token).filter(Boolean);
    check("no máximo 3 pedidos passam (limite do dia = 3)", tokens.length === 3, `passaram ${tokens.length}`);
    const done = await Promise.all(
      tokens.concat(tokens).map((t) => call("POST", "/polens/rewarded-ad/complete", { token: tC, body: { reward_token: t } }))
    );
    check("cada recompensa credita uma vez", done.filter((r) => r.status === 200).length === tokens.length, `creditadas ${done.filter((r) => r.status === 200).length}`);

    // ═══ 5. webhook: valor reconferido ═══════════════════════════════════
    console.log("\n━━━ 5. webhook: valor e moeda reconferidos ━━━");
    const fulfilled = [];
    const realFulfill = StripeWebhookService.fulfillCheckoutSession;
    const realGetPayment = mp.getPayment;
    StripeWebhookService.fulfillCheckoutSession = async (s) => { fulfilled.push(s.id); };
    try {
      const mkIntent = async () =>
        PaymentIntentStorage.create(pool, {
          provider: "mercadopago", flow: "polen_purchase", id_user: C.id_user,
          payload: { type: "polen_purchase", user_id: C.id_user }, amount_cents: 1000,
        });
      const i1 = await mkIntent();
      mp.getPayment = async (id) => ({ id, status: "approved", transaction_amount: 5, currency_id: "BRL", external_reference: i1.id_payment_intent });
      let r = await MercadoPagoWebhookService.dispatchEvent({ type: "payment", data: { id: `p${uid()}` } });
      check("pagou R$ 5 numa intenção de R$ 10 → não entrega", !fulfilled.includes(i1.id_payment_intent) && r.reason === "amount_mismatch", JSON.stringify(r));
      const i2 = await mkIntent();
      mp.getPayment = async (id) => ({ id, status: "approved", transaction_amount: 10, currency_id: "USD", external_reference: i2.id_payment_intent });
      r = await MercadoPagoWebhookService.dispatchEvent({ type: "payment", data: { id: `p${uid()}` } });
      check("moeda trocada (USD) → não entrega", !fulfilled.includes(i2.id_payment_intent), JSON.stringify(r));
      const i3 = await mkIntent();
      mp.getPayment = async (id) => ({ id, status: "approved", transaction_amount: 10, currency_id: "BRL", external_reference: i3.id_payment_intent });
      r = await MercadoPagoWebhookService.dispatchEvent({ type: "payment", data: { id: `p${uid()}` } });
      check("valor certo → entrega", fulfilled.includes(i3.id_payment_intent), JSON.stringify(r));
      await pool.query(`DELETE FROM public.tb_payment_intent WHERE id_payment_intent = ANY($1::uuid[])`, [[i1, i2, i3].map((i) => i.id_payment_intent)]).catch(() => {});
    } finally {
      StripeWebhookService.fulfillCheckoutSession = realFulfill;
      mp.getPayment = realGetPayment;
    }

    // ═══ 6. cupom × prazo da cobrança ════════════════════════════════════
    console.log("\n━━━ 6. cobrança com cupom vence antes da reserva ━━━");
    const provider = require("../src/integrations/payments/providers/mercadopago");
    const realPref = mp.createPreference;
    const prefs = [];
    mp.createPreference = async (p) => { prefs.push(p); return { id: "pref", init_point: "https://mp.test" }; };
    try {
      const reqBase = { flow: "xp_boost", amount_cents: 500, productName: "x", successUrl: "https://freelandoo.test/ok", cancelUrl: "https://freelandoo.test/no" };
      await provider.createCheckout({ ...reqBase, payload: { gold_coupon_id: crypto.randomUUID() } }, { intentId: crypto.randomUUID() });
      await provider.createCheckout({ ...reqBase, payload: {} }, { intentId: crypto.randomUUID() });
      const until = prefs[0]?.date_of_expiration ? new Date(prefs[0].date_of_expiration).getTime() : 0;
      check("com cupom: a preferência expira", prefs[0]?.expires === true && until > Date.now(), JSON.stringify(prefs[0]?.expiration_date_to));
      check("…antes da reserva de 3 h do cupom", until < Date.now() + 3 * 3600e3, new Date(until).toISOString());
      check("sem cupom: sem prazo (nada muda)", prefs[1] && prefs[1].expires === undefined);
    } finally {
      mp.createPreference = realPref;
    }

    // ═══ 7. compartilhamento ═════════════════════════════════════════════
    console.log("\n━━━ 7. pontos de compartilhamento ━━━");
    const owner = await createUser();
    const member = await createUser();
    const { rows: mach } = await pool.query(`SELECT id_machine FROM tb_machine ORDER BY id_machine LIMIT 1`);
    const community = await CommunityStorage.createCommunity(pool, {
      id_user: owner.id_user, id_machine: mach[0].id_machine, display_name: `Com A2 ${uid()}`,
      bio: null, avatar_url: null, theme: null, kind: "common",
      address: { street: "Rua", number: "1", complement: null, neighborhood: "C", cep: "01310100", estado: "SP", municipio: "Sao Paulo" },
    });
    const idc = community.id_profile;
    await CommunityStorage.addMember(pool, idc, member.id_user);
    const item = (await pool.query(
      `INSERT INTO tb_profile_portfolio_item (id_profile, title) VALUES ($1, 'post') RETURNING id_portfolio_item`,
      [member.id_profile]
    )).rows[0].id_portfolio_item;
    const count = async () =>
      Number((await pool.query(`SELECT COUNT(*)::int n FROM public.tb_community_share_return WHERE id_community_profile = $1`, [idc])).rows[0].n);

    for (let i = 0; i < 5; i++) {
      await call("POST", `/communities/${idc}/share-return`, {
        body: { id_member_user: member.id_user, id_portfolio_item: item, visitor_hash: `forjado${i}` },
      });
    }
    check("POST com marca inventada não conta ponto", (await count()) === 0, `contou ${await count()}`);
    let r = await call("GET", `/communities/${idc}/s/${member.id_user}/${item}`, { redirect: "manual", headers: { "User-Agent": "Navegador-1" } });
    check("visita pelo link redireciona para a comunidade", r.status === 302 && r.location === `https://freelandoo.test/comunidades/${idc}`, `${r.status} ${r.location}`);
    check("a visita conta 1 ponto", (await count()) === 1, `contou ${await count()}`);
    await call("GET", `/communities/${idc}/s/${member.id_user}/${item}`, { redirect: "manual", headers: { "User-Agent": "Navegador-1" } });
    check("o mesmo visitante de novo não conta", (await count()) === 1, `contou ${await count()}`);
    r = await call("GET", `/communities/${idc}/s/nao-e-uuid/${item}`, { redirect: "manual" });
    check("id torto: redireciona sem quebrar e sem contar", r.status === 302 && (await count()) === 1, `${r.status}`);

    // ═══ 8. vitrine vencida ══════════════════════════════════════════════
    console.log("\n━━━ 8. anúncio vencido não vende ━━━");
    const Svc = require("../src/services/CommunityListingOrderService");
    const LStore = require("../src/storages/CommunityListingStorage");
    const realCtx = Svc._ctx;
    const realGet = LStore.getById;
    Svc._ctx = async () => ({ community: { id_profile: idc, kind: "condo" } });
    try {
      for (const [label, row] of [
        ["vencido", { status: "active", is_live: false, paid_until: new Date(Date.now() - 864e5) }],
        ["rascunho", { status: "active", is_live: false, paid_until: null }],
      ]) {
        LStore.getById = async () => ({ id_listing: 1, id_user: owner.id_user, price_cents: 4000, ...row });
        const out = await Svc.checkout({ id_user: member.id_user }, { id_listing: 1 }, {});
        check(`anúncio ${label} → 404 "não encontrado"`, out?.statusCode === 404 && out?.error === "Anúncio não encontrado.", JSON.stringify(out));
      }
    } finally {
      Svc._ctx = realCtx;
      LStore.getById = realGet;
    }
  } finally {
    server.close();
    if (emeraldBefore) {
      await pool.query(`UPDATE public.emerald_settings SET is_active = $1, conversion_enabled = $2 WHERE id = 1`, [emeraldBefore.is_active, emeraldBefore.conversion_enabled]).catch(() => {});
    }
    if (polenBefore) {
      await pool.query(
        `UPDATE public.polen_settings SET is_active = $1, ads_per_day_per_user = $2, cooldown_seconds = $3, daily_polens_limit = $4, polens_per_ad = $5 WHERE id = 1`,
        [polenBefore.is_active, polenBefore.ads_per_day_per_user, polenBefore.cooldown_seconds, polenBefore.daily_polens_limit, polenBefore.polens_per_ad]
      ).catch(() => {});
    }
    await pool.query(`DELETE FROM tb_profile WHERE id_user = ANY($1::uuid[]) AND is_community = TRUE`, [users]).catch(() => {});
    await pool.query(`DELETE FROM tb_user WHERE id_user = ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.end();
  }

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
