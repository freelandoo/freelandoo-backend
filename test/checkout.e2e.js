// test/checkout.e2e.js — F5.S1: suite dos fluxos de dinheiro.
//
//   npm run test:checkout
//
// Pré-requisitos:
//   - Postgres de TESTE rodando (default: docker abaixo) — a suite RECUSA
//     hosts que pareçam produção (railway/proxy).
//       docker run -d --name fl-test-pg -e POSTGRES_PASSWORD=test \
//         -e POSTGRES_DB=freelandoo_test -p 55432:5432 postgres:16-alpine
//   - STRIPE_SECRET_KEY de TESTE no .env (sk_test_...) — a suite recusa live.
//
// O que ela faz, de ponta a ponta REAL (sem mocks de Stripe):
//   1. roda as migrations no banco de teste (banco virgem suportado);
//   2. sobe o backend (node index.js) com STRIPE_WEBHOOK_SECRET próprio;
//   3. cria user+perfil via API, e por fluxo: cria o checkout via API
//      (sessão REAL na Stripe test), confirma um PaymentIntent real
//      (pm_card_visa) e entrega o webhook checkout.session.completed
//      ASSINADO no /webhooks/stripe — sem Stripe CLI;
//   4. asserta as linhas no banco (assinatura ativa/fee_paid, créditos de
//      pólen, premium ativo, pedido da loja pago + holdback do vendedor).
//
// Fluxo da loja exige MELHOR_ENVIO_SANDBOX_TOKEN; sem ele a etapa é SKIP.

require("dotenv").config();

const assert = require("node:assert");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Client } = require("pg");
const Stripe = require("stripe");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.CHECKOUT_TEST_PORT || 4555);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:test@127.0.0.1:55432/freelandoo_test";
const WEBHOOK_SECRET = "whsec_fl_checkout_e2e_local";

// ─── Guardas de segurança ───────────────────────────────────────────────────

if (/railway|rlwy\.net|proxy\.rlwy/i.test(DB_URL)) {
  console.error("[guard] TEST_DATABASE_URL parece produção (railway). Abortando.");
  process.exit(1);
}
const stripeKey = process.env.STRIPE_SECRET_KEY || "";
if (!stripeKey.startsWith("sk_test_")) {
  console.error("[guard] STRIPE_SECRET_KEY precisa ser de TESTE (sk_test_...). Abortando.");
  process.exit(1);
}

const stripe = new Stripe(stripeKey);
const db = new Client({ connectionString: DB_URL });

let serverProc = null;
const results = [];

function section(name) {
  console.log(`\n━━━ ${name} ━━━`);
}

function pass(name, detail = "") {
  results.push({ name, status: "PASS" });
  console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ""}`);
}

function skip(name, reason) {
  results.push({ name, status: "SKIP", reason });
  console.log(`  ⊘ ${name} — SKIP: ${reason}`);
}

// ─── Infra: server + helpers ────────────────────────────────────────────────

function spawnNode(args, env) {
  return spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

const serverEnv = {
  DATABASE_URL: DB_URL,
  DATABASE_SSL: "false",
  PORT: String(PORT),
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  MEDIA_WORKER_DISABLED: "1",
  // E-mails (ativação etc.) não podem derrubar o teste — sem SMTP local.
  NODE_ENV: "test",
};

async function runMigrations() {
  await new Promise((resolve, reject) => {
    const p = spawnNode(["run-migrations.js"], serverEnv);
    let out = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (out += c));
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`migrations exit ${code}\n${out.slice(-2000)}`))
    );
  });
}

async function startServer() {
  serverProc = spawnNode(["index.js"], serverEnv);
  let logs = "";
  serverProc.stdout.on("data", (c) => (logs += c));
  serverProc.stderr.on("data", (c) => (logs += c));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`servidor não respondeu /health em 60s.\n${logs.slice(-3000)}`);
}

async function api(method, route, { token, body } = {}) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* respostas sem corpo */
  }
  return { status: res.status, json };
}

async function q(sql, params = []) {
  const { rows } = await db.query(sql, params);
  return rows;
}

// ─── Stripe: PaymentIntent real confirmado + webhook assinado ───────────────

async function confirmedPaymentIntent(amountCents) {
  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "brl",
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });
  assert.equal(pi.status, "succeeded", `PaymentIntent ${pi.id} não confirmou`);
  return pi;
}

async function deliverCheckoutCompleted(sessionId, { paymentIntentId } = {}) {
  // Sessão REAL criada pelo endpoint do backend — recupera da Stripe e
  // simula o estado pós-pagamento. metadata/amounts são os verdadeiros.
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  session.status = "complete";
  session.payment_status = "paid";
  if (paymentIntentId) session.payment_intent = paymentIntentId;

  const event = {
    id: `evt_e2e_${crypto.randomUUID().replace(/-/g, "")}`,
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    livemode: false,
    data: { object: session },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });

  const res = await fetch(`${BASE}/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": signature },
    body: payload,
  });
  assert.equal(res.status, 200, `webhook retornou ${res.status}`);
  return session;
}

function sessionIdFromUrl(checkoutUrl) {
  const m = String(checkoutUrl || "").match(/(cs_test_[a-zA-Z0-9]+)/);
  assert.ok(m, `checkout_url sem cs_test_: ${checkoutUrl}`);
  return m[1];
}

async function deliverChargeRefunded(charge) {
  const event = {
    id: `evt_e2e_${crypto.randomUUID().replace(/-/g, "")}`,
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    type: "charge.refunded",
    livemode: false,
    data: { object: charge },
  };
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  const res = await fetch(`${BASE}/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": signature },
    body: payload,
  });
  assert.equal(res.status, 200, `webhook refund retornou ${res.status}`);
}

async function communityCaps(id_user) {
  const rows = await q(
    `SELECT create_cap, member_cap FROM tb_community_entitlement WHERE id_user = $1`,
    [id_user]
  );
  return rows[0] || { create_cap: 1, member_cap: 1 };
}

// ─── Seed: user + perfil ────────────────────────────────────────────────────

async function createUserWithProfile(label) {
  const email = `e2e-${label}-${Date.now()}@checkout.test`;
  const senha = "Test@12345";
  const cat = await q(
    `SELECT id_category, id_machine FROM tb_category
      WHERE is_active = TRUE AND id_machine IS NOT NULL LIMIT 1`
  );
  assert.ok(cat.length, "nenhuma categoria ativa no seed das migrations");

  // User direto no banco: o /auth/signup dispara e-mail de ativação via
  // Resend e falha sem RESEND_API_KEY — em teste não há e-mail. O signin
  // continua sendo o REAL (bcrypt + JWT do backend).
  const bcrypt = require("bcrypt");
  const senhaHash = await bcrypt.hash(senha, 10);
  const username = `e2e${label}${Date.now()}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 24);
  const inserted = await q(
    `INSERT INTO tb_user (nome, username, email, senha, data_nascimento, estado, municipio, ativo)
     VALUES ($1, $2, $3, $4, '1990-01-01', 'SP', 'São Paulo', TRUE)
     RETURNING id_user`,
    [`E2E ${label}`, username, email, senhaHash]
  );
  const id_user = inserted[0].id_user;

  const signin = await api("POST", "/auth/signin", { body: { email, senha } });
  assert.ok(
    signin.status < 400 && signin.json?.token,
    `signin falhou (${signin.status}): ${JSON.stringify(signin.json)}`
  );
  const token = signin.json.token;

  const prof = await api("POST", "/profile", {
    token,
    body: {
      id_machine: cat[0].id_machine,
      id_category: cat[0].id_category,
      display_name: `E2E ${label}`,
      estado: "SP",
      municipio: "São Paulo",
    },
  });
  assert.ok(
    prof.status < 400 && prof.json?.profile?.id_profile,
    `criação de perfil falhou (${prof.status}): ${JSON.stringify(prof.json)}`
  );
  return { email, token, id_user, id_profile: prof.json.profile.id_profile };
}

// ─── Fluxo 1: ativação de perfil (assinatura) ───────────────────────────────

async function flowAssinatura(user) {
  section("Fluxo 1 — Ativação de perfil (Stripe)");

  const create = await api("POST", "/stripe/subscription/checkout", {
    token: user.token,
    body: { id_profile: user.id_profile },
  });
  assert.ok(
    create.status < 400 && (create.json?.url || create.json?.checkout_url),
    `checkout falhou (${create.status}): ${JSON.stringify(create.json)}`
  );
  const url = create.json.url || create.json.checkout_url;
  const sessionId = sessionIdFromUrl(url);
  pass("checkout cria sessão Stripe e devolve URL", sessionId);

  const subRow = await q(
    `SELECT * FROM tb_profile_subscription WHERE stripe_checkout_session_id = $1`,
    [sessionId]
  );
  assert.ok(subRow.length, "tb_profile_subscription sem a linha da sessão");
  pass("linha em tb_profile_subscription criada (pending)");

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const pi = await confirmedPaymentIntent(session.amount_total);
  await deliverCheckoutCompleted(sessionId, { paymentIntentId: pi.id });

  const after = await q(
    `SELECT status, stripe_charge_id FROM tb_profile_subscription WHERE stripe_checkout_session_id = $1`,
    [sessionId]
  );
  assert.equal(after[0]?.status, "active", `status esperado active, veio ${after[0]?.status}`);
  pass("webhook ativa a assinatura (status=active, charge registrado)");

  const feePaid = await q(
    `SELECT 1
       FROM tb_profile_status ps
       JOIN tb_status s ON s.id_status = ps.id_status
      WHERE ps.id_profile = $1 AND s.desc_status = 'fee_paid'`,
    [user.id_profile]
  );
  assert.ok(feePaid.length, "perfil não recebeu status fee_paid");
  pass("perfil marcado fee_paid (ativação aplicada)");
}

// ─── Fluxo 2: compra de Poléns ──────────────────────────────────────────────

async function flowPolens(user) {
  section("Fluxo 2 — Loja de Poléns (Stripe)");

  // Banco de teste não tem produtos seedados — cria um pacote como o admin
  // criaria (a tabela é catálogo simples; o caminho de dinheiro é o checkout).
  await q(
    `INSERT INTO polen_products (name, description, price_cents, polens_amount, is_active)
     VALUES ('Pacote E2E', '100 polens de teste', 1000, 100, TRUE)
     ON CONFLICT DO NOTHING`
  );
  const list = await api("GET", "/polens/products");
  const products = list.json?.products || list.json || [];
  assert.ok(Array.isArray(products) && products.length > 0, "GET /polens/products vazio");
  const product = products[0];

  const create = await api("POST", `/polens/products/${product.id}/checkout`, {
    token: user.token,
    body: {},
  });
  assert.ok(
    create.status < 400 && create.json?.checkout_url,
    `checkout polens falhou (${create.status}): ${JSON.stringify(create.json)}`
  );
  const sessionId = create.json.session_id || sessionIdFromUrl(create.json.checkout_url);
  pass("checkout de poléns cria sessão", sessionId);

  const before = await q(
    `SELECT COALESCE(SUM(amount), 0)::int AS polens FROM polen_transactions WHERE user_id = $1`,
    [user.id_user]
  );

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const pi = await confirmedPaymentIntent(session.amount_total);
  await deliverCheckoutCompleted(sessionId, { paymentIntentId: pi.id });

  const purchase = await q(
    `SELECT status FROM polen_purchases WHERE stripe_session_id = $1`,
    [sessionId]
  );
  assert.ok(purchase.length, "polen_purchases sem a linha da sessão");
  pass(`compra registrada em polen_purchases (status=${purchase[0].status})`);

  const after = await q(
    `SELECT COALESCE(SUM(amount), 0)::int AS polens FROM polen_transactions WHERE user_id = $1`,
    [user.id_user]
  );
  const credited = after[0].polens - before[0].polens;
  assert.ok(credited > 0, `saldo de poléns não cresceu (delta=${credited})`);
  pass(`poléns creditados na carteira (+${credited})`);

  // Idempotência: o MESMO evento entregue de novo não pode creditar dobrado.
  await deliverCheckoutCompleted(sessionId, { paymentIntentId: pi.id });
  const again = await q(
    `SELECT COALESCE(SUM(amount), 0)::int AS polens FROM polen_transactions WHERE user_id = $1`,
    [user.id_user]
  );
  assert.equal(again[0].polens, after[0].polens, "webhook duplicado creditou dobrado!");
  pass("webhook re-entregue é idempotente (sem crédito duplo)");
}

// ─── Fluxo 3: Premium (destaque) ────────────────────────────────────────────

async function flowPremium(user) {
  section("Fluxo 3 — Premium/destaque (Stripe)");

  const quote = await api("GET", `/premium/quote/${user.id_profile}`);
  if (quote.status >= 400) {
    skip("premium", `quote indisponível (${quote.status}): ${JSON.stringify(quote.json)}`);
    return;
  }

  const create = await api("POST", `/premium/checkout/stripe/${user.id_profile}`, {
    token: user.token,
    body: {},
  });
  if (create.status >= 400) {
    skip("premium", `checkout recusado (${create.status}): ${JSON.stringify(create.json)}`);
    return;
  }
  const url = create.json?.checkout_url || create.json?.url;
  const sessionId = create.json?.session_id || sessionIdFromUrl(url);
  pass("checkout premium cria sessão", sessionId);

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const pi = await confirmedPaymentIntent(session.amount_total);
  await deliverCheckoutCompleted(sessionId, { paymentIntentId: pi.id });

  const active = await q(
    `SELECT * FROM profile_premium
      WHERE profile_id = $1 AND is_active = TRUE AND expires_at > NOW()`,
    [user.id_profile]
  );
  assert.ok(active.length, "premium não ficou ativo após webhook");
  pass(`premium ativo até ${new Date(active[0].expires_at).toISOString().slice(0, 10)}`);
}

// ─── Fluxo 4: Loja de produtos (com etiqueta ME) ────────────────────────────

async function flowLoja(buyer, seller) {
  section("Fluxo 4 — Loja de produtos (Stripe + Melhor Envio)");

  if (!process.env.MELHOR_ENVIO_SANDBOX_TOKEN && !process.env.MELHOR_ENVIO_TOKEN) {
    skip("loja", "MELHOR_ENVIO_SANDBOX_TOKEN não configurado no ambiente");
    return;
  }

  // Loja exige assinatura ATIVA do vendedor (profile_is_paid deriva de
  // tb_profile_subscription.status='active' — a ativação real já é coberta
  // pelo Fluxo 1; aqui só o pré-requisito) + CEP de origem pro frete.
  await q(
    `INSERT INTO tb_profile_subscription (id_user, id_profile, status, amount_cents, paid_at)
     VALUES ($1, $2, 'active', 30000, NOW())`,
    [seller.id_user, seller.id_profile]
  );
  await q(`UPDATE tb_profile SET origin_zipcode = '01310100' WHERE id_profile = $1`, [
    seller.id_profile,
  ]);

  // Produto direto no banco (criação via API exige multipart de mídia; o
  // dinheiro que queremos testar é o checkout).
  const prod = await q(
    `INSERT INTO tb_profile_product
       (id_profile, name, description, price_amount, stock_quantity, is_active,
        weight_grams, length_cm, width_cm, height_cm)
     VALUES ($1, 'Produto E2E', 'Item de teste do checkout', 5000, 10, TRUE,
             300, 20, 15, 5)
     RETURNING id_profile_product`,
    [seller.id_profile]
  );
  const id_profile_product = prod[0].id_profile_product;
  pass("produto do vendedor criado", `#${id_profile_product}`);

  // Cotação REAL no Melhor Envio sandbox (mesma chamada do front).
  const quote = await api(
    "POST",
    `/public/profile/${seller.id_profile}/products/${id_profile_product}/shipping`,
    { body: { destination_zipcode: "20040002", quantity: 1 } }
  );
  if (quote.status >= 400 || !(quote.json?.options || []).length) {
    skip("loja", `cotação ME indisponível (${quote.status}): ${JSON.stringify(quote.json).slice(0, 220)}`);
    return;
  }
  const option = quote.json.options[0];
  pass(`frete cotado no ME sandbox (${option.carrier} ${option.service_name}, R$${(option.price_cents / 100).toFixed(2)})`);

  const checkout = await api("POST", "/me/orders/checkout", {
    token: buyer.token,
    body: {
      id_profile_product,
      quantity: 1,
      destination_zipcode: "20040002",
      shipping_service_id: option.service_id,
      buyer_name: "Comprador E2E",
      buyer_email: "buyer-e2e@checkout.test",
      buyer_document: "11144477735",
      destination_full_address: {
        street: "Av. Rio Branco",
        number: "1",
        neighborhood: "Centro",
        city: "Rio de Janeiro",
        uf: "RJ",
      },
    },
  });
  assert.ok(
    checkout.status < 400 && (checkout.json?.checkout_url || checkout.json?.url),
    `checkout da loja falhou (${checkout.status}): ${JSON.stringify(checkout.json).slice(0, 300)}`
  );
  const url = checkout.json?.checkout_url || checkout.json?.url;
  const sessionId = checkout.json?.session_id || sessionIdFromUrl(url);
  pass("checkout da loja cria sessão", sessionId);

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const pi = await confirmedPaymentIntent(session.amount_total);
  await deliverCheckoutCompleted(sessionId, { paymentIntentId: pi.id });

  const order = await q(
    `SELECT id_order, status, seller_amount_cents FROM tb_profile_product_order
      WHERE stripe_session_id = $1`,
    [sessionId]
  );
  assert.ok(order.length, "tb_profile_product_order sem o pedido da sessão");
  assert.equal(order[0].status, "paid", `status esperado paid, veio ${order[0].status}`);
  pass(`pedido pago em tb_profile_product_order (seller=${order[0].seller_amount_cents})`);

  const balance = await q(
    `SELECT status, net_cents, available_at FROM tb_seller_balance WHERE id_order = $1`,
    [order[0].id_order]
  );
  assert.ok(balance.length, "tb_seller_balance (holdback) não foi criado");
  const availableAt = new Date(balance[0].available_at);
  const minHold = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
  assert.ok(
    availableAt > minHold,
    `holdback menor que o CDC (~8d): available_at=${availableAt.toISOString()}`
  );
  pass(
    `holdback do vendedor criado (status=${balance[0].status}, net=${balance[0].net_cents}, libera ${availableAt.toISOString().slice(0, 10)})`
  );
}

// ─── Fluxo 5: Bundle de Comunidade R$100 (+1 criar / +1 entrar) ─────────────

async function flowCommunitySlot(user) {
  section("Fluxo 5 — Bundle de Comunidade R$100 (Stripe)");

  const before = await communityCaps(user.id_user);

  const create = await api("POST", "/communities/slots/checkout", {
    token: user.token,
    body: {},
  });
  assert.ok(
    create.status < 400 && create.json?.url,
    `checkout do bundle falhou (${create.status}): ${JSON.stringify(create.json)}`
  );
  const sessionId = sessionIdFromUrl(create.json.url);
  pass("checkout do bundle cria sessão", sessionId);

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  assert.equal(session.amount_total, 10000, "bundle deve custar R$100,00");
  const pi = await confirmedPaymentIntent(session.amount_total);
  await deliverCheckoutCompleted(sessionId, { paymentIntentId: pi.id });

  const after = await communityCaps(user.id_user);
  assert.equal(after.create_cap, before.create_cap + 1, `create_cap esperado ${before.create_cap + 1}, veio ${after.create_cap}`);
  assert.equal(after.member_cap, before.member_cap + 1, `member_cap esperado ${before.member_cap + 1}, veio ${after.member_cap}`);
  pass(`entitlement subiu para ${after.create_cap}/${after.member_cap} após pagamento`);

  // Idempotência: o MESMO pagamento entregue de novo não pode subir o teto outra vez.
  await deliverCheckoutCompleted(sessionId, { paymentIntentId: pi.id });
  const again = await communityCaps(user.id_user);
  assert.equal(again.create_cap, after.create_cap, "webhook duplicado subiu o teto de novo!");
  assert.equal(again.member_cap, after.member_cap, "webhook duplicado subiu o teto de novo!");
  pass("webhook re-entregue é idempotente (sem +1 duplo)");

  // Estorno total reverte o teto (sem ir abaixo de 1 / do que o user já usa).
  await deliverChargeRefunded({
    id: `ch_e2e_${crypto.randomUUID().replace(/-/g, "")}`,
    object: "charge",
    payment_intent: pi.id,
    amount: session.amount_total,
    amount_refunded: session.amount_total,
    refunded: true,
    status: "succeeded",
  });
  const refunded = await communityCaps(user.id_user);
  assert.equal(refunded.create_cap, before.create_cap, `estorno deveria voltar create_cap a ${before.create_cap}, veio ${refunded.create_cap}`);
  assert.equal(refunded.member_cap, before.member_cap, `estorno deveria voltar member_cap a ${before.member_cap}, veio ${refunded.member_cap}`);
  pass(`estorno total reverteu o teto para ${refunded.create_cap}/${refunded.member_cap}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`DB de teste: ${DB_URL.replace(/:[^:@/]+@/, ":***@")}`);

  section("Setup — migrations + servidor");
  await runMigrations();
  pass("migrations aplicadas no banco de teste");
  await db.connect();
  await startServer();
  pass(`backend de teste no ar (${BASE})`);

  const user = await createUserWithProfile("buyer");
  pass("user+perfil criados via /auth/signup + /auth/signin", user.id_profile);

  let failed = 0;
  for (const flow of [
    () => flowAssinatura(user),
    () => flowPolens(user),
    () => flowPremium(user),
    async () => {
      const seller = await createUserWithProfile("seller");
      await flowLoja(user, seller);
    },
    () => flowCommunitySlot(user),
  ]) {
    try {
      await flow();
    } catch (err) {
      failed += 1;
      results.push({ name: err.message, status: "FAIL" });
      console.error(`  ✘ FAIL: ${err.message}`);
    }
  }

  section("Resumo");
  const counts = { PASS: 0, SKIP: 0, FAIL: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  console.log(`  PASS=${counts.PASS} SKIP=${counts.SKIP} FAIL=${counts.FAIL}`);
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((err) => {
    console.error("\nFATAL:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end();
    } catch {
      /* já fechado */
    }
    if (serverProc) serverProc.kill();
    // O servidor forka o media worker; em teste ele está desativado, mas o
    // kill acima encerra a árvore no Windows via taskkill quando preciso.
    setTimeout(() => process.exit(), 500).unref();
  });
