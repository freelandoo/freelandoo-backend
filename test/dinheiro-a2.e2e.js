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
//   — sessão 2 (14/11) —
//   9. conta de repasse da academia: chave PIX CPF/CNPJ de outra pessoa (A2-10);
//  10. recebimento do afiliado: chave CNPJ de terceiro (A2-11);
//  11. repasse da academia: 20 "marcar pago" em paralelo, estado, id torto;
//  12. estorno pelo webhook antes/depois do PIX, parcial, repetido e simultâneo;
//  13. comprar embrião: 20 em paralelo, mesma chave 20×, valores tortos.
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
// CPF/CNPJ válidos (dígitos verificadores) e aleatórios.
function docDigits(base, weights) {
  const s = weights.reduce((acc, w, i) => acc + Number(base[i]) * w, 0) % 11;
  return s < 2 ? 0 : 11 - s;
}
function cpf() {
  let b = Array.from({ length: 9 }, () => crypto.randomInt(10)).join("");
  if (/^(\d)\1+$/.test(b)) b = "123456789";
  b += docDigits(b, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return b + docDigits(b, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
}
function cnpj() {
  let b = Array.from({ length: 8 }, () => crypto.randomInt(10)).join("") + "0001";
  b += docDigits(b, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return b + docDigits(b, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
}

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

    // ═══ 9. saque da academia: chave PIX alheia ══════════════════════════
    console.log("\n━━━ 9. conta de repasse da academia: chave PIX de outra pessoa ━━━");
    const AcademyFeeService = require("../src/services/AcademyFeeService");
    const gymOwner = await createUser();
    const ownerCpf = cpf();
    const otherCpf = cpf();
    const gymCnpj = cnpj();
    const otherCnpj = cnpj();
    await pool.query(`UPDATE tb_user SET cpf = $2 WHERE id_user = $1`, [gymOwner.id_user, ownerCpf]);
    const idAcademy = (
      await pool.query(
        `INSERT INTO public.tb_academy (id_owner_user, nome, slug, api_base_url, api_token_enc)
         VALUES ($1, 'Academia A2', $2, 'https://gym.test', 'x') RETURNING id_academy`,
        [gymOwner.id_user, `a2-${uid()}`]
      )
    ).rows[0].id_academy;
    const put = (u, body) => AcademyFeeService.putAccount({ id_user: u.id_user }, idAcademy, { holder_name: "Titular", ...body });
    let acc = await put(gymOwner, { holder_doc: ownerCpf, pix_key_type: "cpf", pix_key: otherCpf });
    check("titular = meu CPF, chave PIX = CPF de outro → recusa", acc?.statusCode === 400, JSON.stringify(acc));
    acc = await put(gymOwner, { holder_doc: ownerCpf, pix_key_type: "cnpj", pix_key: otherCnpj });
    check("titular = meu CPF, chave PIX = CNPJ qualquer → recusa", acc?.statusCode === 400, JSON.stringify(acc));
    acc = await put(gymOwner, { holder_doc: gymCnpj, pix_key_type: "cnpj", pix_key: otherCnpj });
    check("titular = CNPJ da academia, chave = outro CNPJ → recusa", acc?.statusCode === 400, JSON.stringify(acc));
    acc = await put(gymOwner, { holder_doc: gymCnpj, pix_key_type: "cpf", pix_key: otherCpf });
    check("titular = CNPJ, chave = CPF de outra pessoa → recusa", acc?.statusCode === 400, JSON.stringify(acc));
    const nAcc = async () => Number((await pool.query(`SELECT COUNT(*) FROM public.tb_academy_payout_account WHERE id_academy = $1`, [idAcademy])).rows[0].count);
    check("nenhuma conta gravada pelas recusas", (await nAcc()) === 0, String(await nAcc()));
    acc = await put(gymOwner, { holder_doc: ownerCpf, pix_key_type: "cpf", pix_key: ownerCpf });
    check("chave = meu CPF passa", !acc?.error && acc?.account?.pix_key_type === "cpf", JSON.stringify(acc));
    acc = await put(gymOwner, { holder_doc: gymCnpj, pix_key_type: "cnpj", pix_key: gymCnpj });
    check("chave = CNPJ da academia passa", !acc?.error && acc?.account?.holder_doc_type === "cnpj", JSON.stringify(acc));
    acc = await put(gymOwner, { holder_doc: gymCnpj, pix_key_type: "cpf", pix_key: ownerCpf });
    check("titular CNPJ com a chave CPF do dono passa", !acc?.error, JSON.stringify(acc));
    acc = await put(gymOwner, { holder_doc: ownerCpf, pix_key_type: "email", pix_key: "dono@gym.test" });
    check("chave e-mail passa (não dá para conferir o titular)", !acc?.error, JSON.stringify(acc));
    acc = await put(member, { holder_doc: ownerCpf, pix_key_type: "cpf", pix_key: ownerCpf });
    check("quem não é dono não mexe na conta (403)", acc?.statusCode === 403, JSON.stringify(acc));

    // ═══ 10. saque do afiliado: chave PIX alheia ═════════════════════════
    console.log("\n━━━ 10. recebimento do afiliado: chave PIX de outra pessoa ━━━");
    const aff = await createUser();
    const affCpf = cpf();
    const affCnpj = cnpj();
    await pool.query(`UPDATE tb_user SET cpf = $2 WHERE id_user = $1`, [aff.id_user, affCpf]);
    await pool.query(`INSERT INTO public.tb_affiliate (id_user) VALUES ($1)`, [aff.id_user]);
    const tAff = tokenOf(aff);
    const payInfo = (body) => call("PUT", "/me/affiliate/payout-info", { token: tAff, body: { legal_name: "Afiliado", ...body } });
    r = await payInfo({ tax_id: affCpf, pix_key_type: "cpf", pix_key: cpf() });
    check("afiliado: chave CPF de outro → 400", r.status === 400, `${r.status}`);
    r = await payInfo({ tax_id: affCpf, pix_key_type: "cnpj", pix_key: cnpj() });
    check("afiliado: meu CPF + chave CNPJ de terceiro → 400", r.status === 400, `${r.status}`);
    r = await payInfo({ tax_id: affCnpj, pix_key_type: "cnpj", pix_key: cnpj() });
    check("afiliado: meu CNPJ + chave de OUTRO CNPJ → 400", r.status === 400, `${r.status}`);
    const affRow = async () => (await pool.query(`SELECT pix_key FROM public.tb_affiliate WHERE id_user = $1`, [aff.id_user])).rows[0];
    check("nenhuma chave gravada pelas recusas", (await affRow()).pix_key == null, JSON.stringify(await affRow()));
    r = await payInfo({ tax_id: affCnpj, pix_key_type: "cnpj", pix_key: affCnpj });
    check("afiliado: chave = o próprio CNPJ passa", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
    r = await payInfo({ tax_id: affCpf, pix_key_type: "cpf", pix_key: affCpf });
    check("afiliado: chave = o próprio CPF passa", r.status === 200, `${r.status}`);

    // ═══ 11. repasse da academia: 20 "marcar pago" em paralelo ═══════════
    console.log("\n━━━ 11. repasse da academia: corrida e estado ━━━");
    const adm = await createUser();
    const role = await pool.query(`SELECT id_role FROM tb_role WHERE desc_role = 'Administrator' LIMIT 1`);
    await pool.query(`INSERT INTO tb_user_role (id_user, id_role, is_active) VALUES ($1,$2,TRUE)`, [adm.id_user, role.rows[0].id_role]);
    const tAdm = tokenOf(adm);
    const student = await createUser();
    async function feeOrder({ payout }) {
      const ref = `mp-${uid()}`;
      const o = (
        await pool.query(
          `INSERT INTO public.tb_academy_fee_order
             (id_academy, id_user, external_id, amount_cents, net_cents, status, payment_provider, session_id, provider_ref, paid_at)
           VALUES ($1, $2, $3, 10000, 9500, 'paid', 'mercadopago', $4, $4, NOW()) RETURNING id_order`,
          [idAcademy, student.id_user, `ext-${uid()}`, ref]
        )
      ).rows[0].id_order;
      const p = (
        await pool.query(
          `INSERT INTO public.tb_academy_payout (id_order, id_academy, charge_cents, net_cents, status, available_at)
           VALUES ($1, $2, 10000, 9500, $3, NOW()) RETURNING id_payout`,
          [o, idAcademy, payout]
        )
      ).rows[0].id_payout;
      return { id_order: o, id_payout: p, ref };
    }
    const pst = async (id) => (await pool.query(`SELECT status FROM public.tb_academy_payout WHERE id_payout = $1`, [id])).rows[0]?.status;
    const ost = async (id) => (await pool.query(`SELECT status, refunded_at FROM public.tb_academy_fee_order WHERE id_order = $1`, [id])).rows[0];
    const f1 = await feeOrder({ payout: "aprovado" });
    const paidRs = await Promise.all(
      Array.from({ length: 20 }, () => call("POST", `/admin/academy-payouts/${f1.id_payout}/paid`, { token: tAdm, body: { note: "pix" } }))
    );
    const paidOk = paidRs.filter((x) => x.status === 200).length;
    check("20 cliques em 'pago' → 1 passa, 19 recusam", paidOk === 1 && paidRs.filter((x) => x.status === 409).length === 19, `${paidOk} ok; ${[...new Set(paidRs.map((x) => x.status))]}`);
    const f2 = await feeOrder({ payout: "aguardando" });
    r = await call("POST", `/admin/academy-payouts/${f2.id_payout}/paid`, { token: tAdm, body: {} });
    check("repasse ainda no prazo (aguardando) não marca pago", r.status === 409 && (await pst(f2.id_payout)) === "aguardando", `${r.status}`);
    r = await call("POST", `/admin/academy-payouts/abc/paid`, { token: tAdm, body: {} });
    check("id torto não quebra (4xx)", r.status >= 400 && r.status < 500, `${r.status}`);
    r = await call("POST", `/admin/academy-payouts/${f2.id_payout}/paid`, { token: tokenOf(gymOwner), body: {} });
    check("dono da academia não marca o próprio repasse como pago (403)", r.status === 403, `${r.status}`);

    // ═══ 12. estorno pelo webhook, em cada estado ════════════════════════
    console.log("\n━━━ 12. estorno pelo webhook (mensalidade da academia) ━━━");
    const refund = (ref, { amount = 10000, refunded = 10000 } = {}) =>
      StripeWebhookService.dispatchEvent({
        id: `evt-${uid()}`,
        type: "charge.refunded",
        data: { object: { id: `ch-${uid()}`, payment_intent: ref, amount, amount_refunded: refunded } },
      });
    const g1 = await feeOrder({ payout: "aguardando" });
    await refund(g1.ref, { refunded: 3000 });
    check("estorno PARCIAL não reverte nada", (await pst(g1.id_payout)) === "aguardando" && (await ost(g1.id_order)).status === "paid");
    await refund(g1.ref);
    check("antes do PIX: repasse 'revertido', pedido 'refunded'", (await pst(g1.id_payout)) === "revertido" && (await ost(g1.id_order)).status === "refunded", `${await pst(g1.id_payout)} ${(await ost(g1.id_order)).status}`);
    const g2 = await feeOrder({ payout: "aprovado" });
    await refund(g2.ref);
    check("aprovado e estornado: 'revertido' (não sai PIX)", (await pst(g2.id_payout)) === "revertido");
    r = await call("POST", `/admin/academy-payouts/${g2.id_payout}/paid`, { token: tAdm, body: {} });
    check("repasse revertido não pode mais ser marcado pago", r.status === 409 && (await pst(g2.id_payout)) === "revertido", `${r.status}`);
    const g3 = await feeOrder({ payout: "pago" });
    await refund(g3.ref);
    check("depois do PIX: repasse vira 'devido'", (await pst(g3.id_payout)) === "devido", await pst(g3.id_payout));
    check("depois do PIX: o estorno fica registrado no pedido", (await ost(g3.id_order)).refunded_at != null, JSON.stringify(await ost(g3.id_order)));
    await refund(g3.ref);
    await Promise.all([refund(g1.ref), refund(g1.ref), refund(g1.ref)]);
    check("estorno repetido/simultâneo não muda nada", (await pst(g3.id_payout)) === "devido" && (await pst(g1.id_payout)) === "revertido");
    const nPayouts = Number((await pool.query(`SELECT COUNT(*) FROM public.tb_academy_payout WHERE id_order = ANY($1::bigint[])`, [[g1.id_order, g2.id_order, g3.id_order]])).rows[0].count);
    check("nenhum repasse novo nasce do estorno", nPayouts === 3, String(nPayouts));

    // ═══ 13. comprar embrião (Meu Mundo) ═════════════════════════════════
    console.log("\n━━━ 13. comprar embrião: corrida, chave e valores ━━━");
    const Life = require("../src/services/MeuMundoLifeService");
    const Chars = require("../src/services/MeuMundoCharacterService");
    const CharsRule = require("../src/utils/meuMundoCharacters");
    const lifePerks = Life.adminPerks;
    Life.adminPerks = false;
    try {
      const P = await createUser();
      await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'raposa', 'f') ON CONFLICT DO NOTHING`, [P.id_user]);
      await Life.peek(P.id_user);
      const price = CharsRule.embryoPrice("raposa");
      const setEm = (n) => pool.query(`UPDATE public.emerald_wallets SET balance = $2 WHERE user_id = $1`, [P.id_user, n]);
      const grants = async () => Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_character_grant WHERE id_user = $1`, [P.id_user])).rows[0].count);
      const spent = async () =>
        Number((await pool.query(`SELECT COALESCE(SUM(amount),0) AS s FROM public.emerald_transactions WHERE user_id = $1 AND metadata->>'what' LIKE 'embryo:%'`, [P.id_user])).rows[0].s);
      await setEm(price * 2);
      const buys = await Promise.all(
        Array.from({ length: 20 }, (_, i) => Chars.buyEmbryo(P.id_user, { species: "raposa", key: `emb-corrida-${i}-${uid()}` }))
      );
      const bought = buys.filter((b) => b && !b.error && (b.granted || []).length === 1).length;
      check("20 compras em paralelo com saldo para 2 → 2 embriões", bought === 2, `${bought}; ${[...new Set(buys.map((b) => b.code || "ok"))]}`);
      check("Esmeralda zerada, nunca negativa", (await emerald(P)) === 0, String(await emerald(P)));
      check("grants = embriões pagos (recusa não deixa grant)", (await grants()) === 2, String(await grants()));
      check("ledger do embrião = 2 × preço", Math.abs(await spent()) === price * 2, String(await spent()));
      await setEm(price * 5);
      const k1 = `emb-mesma-${uid()}`;
      const same = await Promise.all(Array.from({ length: 20 }, () => Chars.buyEmbryo(P.id_user, { species: "raposa", key: k1 })));
      check("a mesma chave 20 vezes compra uma vez", (await emerald(P)) === price * 4 && (await grants()) === 3, `saldo ${await emerald(P)} grants ${await grants()}`);
      check("as repetições respondem 'repeat', sem erro", same.filter((b) => b && b.repeat === true).length === 19, JSON.stringify(same.map((b) => b.code || (b.repeat ? "r" : "ok"))));
      const before = await emerald(P);
      for (const [label, body] of [
        ["espécie inventada", { species: "dragao-dourado", key: `emb-x-${uid()}` }],
        ["sexo torto", { species: "raposa", sex: "x", key: `emb-x-${uid()}` }],
        ["chave curta", { species: "raposa", key: "k" }],
        ["chave com SQL", { species: "raposa", key: "a'; DROP TABLE x;--" }],
        ["sem chave", { species: "raposa" }],
        ["espécie como objeto", { species: { $ne: 1 }, key: `emb-x-${uid()}` }],
      ]) {
        const out = await Chars.buyEmbryo(P.id_user, body);
        check(`embrião com ${label} → recusa`, out && out.error, JSON.stringify(out));
      }
      check("recusas não cobram nem criam grant", (await emerald(P)) === before && (await grants()) === 3, `${await emerald(P)} ${await grants()}`);
    } finally {
      Life.adminPerks = lifePerks;
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
    await pool.query(`DELETE FROM public.tb_affiliate WHERE id_user = ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM tb_user WHERE id_user = ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.end();
  }

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
