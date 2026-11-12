// test/authz-site.e2e.js — Segurança A1, lote 4 (site da comunidade e agendamento).
//
//   npm run test:authz:site   (ou `npm run test:authz`, que roda os lotes)
//
// Pergunta por rota: se a conta B trocar o id da URL pelo da comunidade (ou do
// perfil) da A, o servidor recusa? O que o site publica de quem atende é só a
// projeção pública? E quem agenda: o nome dele fica com o dono da agenda?
// Tudo pelo HTTP do app real, contra o Postgres LOCAL de teste (porta 55432).
//
// Seções:
//   0. anônimo → 401 nas rotas de escrita do site e na agenda do dono;
//   1. site da A: B não salva, não publica, não troca o endereço, não vê nem
//      aceita oferta, não pede site, não mexe em domínio, equipe nem imagem;
//      rascunho não existe para B; publicar sem plano é recusado;
//   2. site publicado: a vitrine é projeção campo a campo (sem régua de
//      comissão, sem e-mail/CPF de quem atende); site de comunidade privada
//      fica trancado para anônimo e para quem é de fora (nem o próximo horário);
//   3. equipe (A1-18): quem saiu da comunidade sai do site e deixa de carimbar
//      a origem das reservas;
//   4. agenda da A: B não lê nem grava regras, exceções, sinal, reservas nem a
//      semana do dono; não apaga exceção da A pelo próprio perfil; não muda o
//      status da reserva da A; a semana pública diz "Reservado", sem o cliente;
//   5. confirmação por token: só o token abre, e a resposta é enxuta;
//   6. rotas de admin do lote recusam usuário comum (403).
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
const tag = uid();

execFileSync(process.execPath, ["run-migrations.js"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env },
  stdio: "ignore",
});

const pool = require("../src/databases");
const app = require("../src/app");
const CommunityStorage = require("../src/storages/CommunityStorage");
const CommunityProfessionalStorage = require("../src/storages/CommunityProfessionalStorage");
const BookingStorage = require("../src/storages/BookingStorage");
const BookingAvailabilityStorage = require("../src/storages/BookingAvailabilityStorage");
const BookingAlertService = require("../src/services/BookingAlertService");
const FeatureFlagService = require("../src/services/FeatureFlagService");

let base;
async function call(method, p, { token, body } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${p}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _text: text };
  }
  return { status: res.status, body: json, text };
}

async function createUser(nome) {
  const r = await pool.query(
    `INSERT INTO tb_user (nome, username, email, senha, data_nascimento, ativo)
     VALUES ($1,$2,$3,'$2b$10$abcdefghijklmnopqrstuuJ1aJ0aB2cD3eF4gH5iJ6kL7mN8oP9q','1990-01-01',TRUE)
     RETURNING id_user, email, username`,
    [nome, `authzs${uid()}`, `authzs${uid()}@t.test`]
  );
  const p = await pool.query(
    `INSERT INTO tb_profile (id_user, id_category, display_name, sub_profile_slug, is_active, is_visible, is_user_account)
     VALUES ($1, (SELECT id_category FROM tb_category ORDER BY id_category LIMIT 1), $2, $3, TRUE, TRUE, TRUE)
     RETURNING id_profile`,
    [r.rows[0].id_user, nome, `conta-${uid()}`]
  );
  return { ...r.rows[0], id_profile: p.rows[0].id_profile };
}
const tokenOf = (u) => jwt.sign({ id_user: u.id_user, email: u.email }, process.env.JWT_SECRET, { expiresIn: "1h" });

async function mkCommunity(owner, { privacy, name }) {
  const { rows } = await pool.query(`SELECT id_machine FROM tb_machine ORDER BY id_machine LIMIT 1`);
  const community = await CommunityStorage.createCommunity(pool, {
    id_user: owner,
    id_machine: rows[0].id_machine,
    display_name: name,
    bio: null,
    avatar_url: null,
    theme: null,
    kind: "common",
    address: {
      street: "Rua Teste", number: "1", complement: null, neighborhood: "Centro",
      cep: "01310100", estado: "SP", municipio: "Sao Paulo",
    },
  });
  if (privacy === "private") {
    await CommunityStorage.setPrivacy(pool, community.id_profile, { privacy: "private", monthly_cents: 1000 });
  }
  await CommunityStorage.addMember(pool, community.id_profile, owner, "leader");
  return community.id_profile;
}

/** Site gravado e (opcionalmente) publicado direto no banco: publicar pela
 * porta exige plano, e o que este teste mede é quem LÊ, não quem paga. */
async function mkSite(id_profile, { published, slug }) {
  await pool.query(
    `INSERT INTO tb_community_site (id_profile, site_name, tagline, theme, sections, is_published, published_at)
     VALUES ($1, 'Site QA', 'tagline', '{}'::jsonb, '[]'::jsonb, $2, CASE WHEN $2 THEN NOW() END)`,
    [id_profile, published]
  );
  if (slug) {
    await pool.query(`UPDATE tb_profile SET community_site_slug = $2 WHERE id_profile = $1`, [id_profile, slug]);
  }
}

async function mkService(id_profile, name) {
  await pool.query(
    `INSERT INTO tb_profile_service (id_profile, name, description, duration_minutes, price_amount, is_active)
     VALUES ($1, $2, 'teste', 30, 5000, TRUE)`,
    [id_profile, name]
  );
}

const FORBIDDEN_PERSON_KEYS = ["email", "cpf", "telefone", "phone", "data_nascimento", "senha", "client_email", "client_whatsapp"];
const FORBIDDEN_SERVICE_KEYS = ["affiliate_percent", "affiliates_allowed", "created_by_user"];

(async () => {
  const A = await createUser("Conta A"); // líder das duas comunidades, dona da agenda
  const B = await createUser("Conta B"); // de fora
  const M = await createUser("Conta M"); // membro da pública, promovida à equipe do site
  const users = [A.id_user, B.id_user, M.id_user];
  const tA = tokenOf(A);
  const tB = tokenOf(B);
  const tM = tokenOf(M);
  const communities = [];

  const prevFlags = (
    await pool.query(`SELECT flag_key, is_enabled FROM tb_feature_flag WHERE flag_key = ANY($1)`, [["comunidade_site", "comunidade_privada"]])
  ).rows;
  await pool.query(`UPDATE tb_feature_flag SET is_enabled = TRUE WHERE flag_key = ANY($1)`, [["comunidade_site", "comunidade_privada"]]);
  FeatureFlagService.invalidate?.();

  const pub = await mkCommunity(A.id_user, { privacy: "public", name: `Site Publica ${tag}` });
  const priv = await mkCommunity(A.id_user, { privacy: "private", name: `Site Privada ${tag}` });
  const draft = await mkCommunity(A.id_user, { privacy: "public", name: `Site Rascunho ${tag}` });
  communities.push(pub, priv, draft);
  const slugPub = `authz-pub-${tag}`;
  const slugPriv = `authz-priv-${tag}`;
  await mkSite(pub, { published: true, slug: slugPub });
  await mkSite(priv, { published: true, slug: slugPriv });
  await mkSite(draft, { published: false });

  await CommunityStorage.addMember(pool, pub, M.id_user, "member");
  await CommunityProfessionalStorage.add(pool, pub, M.id_user, A.id_user);
  await mkService(A.id_profile, `Corte A ${tag}`);
  await mkService(M.id_profile, `Barba M ${tag}`);

  // Reserva de um cliente convidado na agenda da A.
  const booking = await BookingStorage.create(pool, {
    id_profile: A.id_profile,
    profile_owner_user_id: A.id_user,
    client_name: "Cliente Sigiloso",
    client_email: "cliente.sigiloso@t.test",
    client_whatsapp: "11999990000",
    booking_date: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
    start_time: "10:00",
    end_time: "10:30",
    deposit_amount: 0,
    platform_fee_amount: 0,
    professional_amount: 0,
    stripe_checkout_session_id: null,
    status: "confirmed",
    payment_status: "on_site",
    processor_fee_source: "none",
  });
  const overrideDate = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  const override = await BookingAvailabilityStorage.upsertOverride(pool, {
    id_profile: A.id_profile, override_date: overrideDate, is_day_blocked: true, note: "folga",
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  try {
    let r;
    // ═══ 0. anônimo ═════════════════════════════════════════════════════
    console.log("\n━━━ 0. anônimo → 401 ━━━");
    const AUTH_ROUTES = [
      ["PUT", `/communities/${pub}/site`], ["PATCH", `/communities/${pub}/site/slug`],
      ["POST", `/communities/${pub}/site/publish`], ["POST", `/communities/${pub}/site/request`],
      ["GET", `/communities/${pub}/site/offer`], ["POST", `/communities/${pub}/site/offer/accept`],
      ["GET", `/communities/${pub}/site/domains`], ["POST", `/communities/${pub}/site/domains`],
      ["GET", `/communities/${pub}/site/professionals`], ["POST", `/communities/${pub}/site/professionals`],
      ["DELETE", `/communities/${pub}/site/professionals/${M.id_user}`], ["POST", `/communities/${pub}/site/media`],
      ["GET", `/profile/${A.id_profile}/availability`], ["POST", `/profile/${A.id_profile}/availability`],
      ["GET", `/profile/${A.id_profile}/availability-overrides`], ["GET", `/profile/${A.id_profile}/booking-settings`],
      ["GET", `/profile/${A.id_profile}/bookings`], ["GET", `/profile/${A.id_profile}/calendar/week?weekStart=2026-01-05&weekEnd=2026-01-11`],
      ["GET", `/public/profile/my-bookings`], ["PATCH", `/public/profile/bookings/${booking.id}/status`],
      ["GET", `/me/booking-payouts`],
    ];
    for (const [m, p] of AUTH_ROUTES) {
      r = await call(m, p, { body: m === "GET" ? undefined : {} });
      check(`${m} ${p.replace(pub, ":c").replace(A.id_profile, ":p")} sem login = 401`, r.status === 401, `veio ${r.status}`);
    }

    // ═══ 1. site da A, visto por B ══════════════════════════════════════
    console.log("\n━━━ 1. site da A, visto por B ━━━");
    const before = (await pool.query(`SELECT site_name, is_published FROM tb_community_site WHERE id_profile=$1`, [pub])).rows[0];
    const WRITE = [
      ["PUT", `/communities/${pub}/site`, { config: { siteName: "tomado", sections: [] } }],
      ["PATCH", `/communities/${pub}/site/slug`, { slug: `tomado-${tag}` }],
      ["POST", `/communities/${pub}/site/publish`, { published: false }],
      ["POST", `/communities/${pub}/site/request`, { note: "quero" }],
      ["GET", `/communities/${pub}/site/offer`],
      ["POST", `/communities/${pub}/site/offer/accept`, { id_offer: crypto.randomUUID() }],
      ["POST", `/communities/${pub}/site/release`, {}],
      ["GET", `/communities/${pub}/site/domains`],
      ["POST", `/communities/${pub}/site/domains`, { domain: `authz-${tag}.com.br` }],
      ["POST", `/communities/${pub}/site/domains/1/verify`, {}],
      ["POST", `/communities/${pub}/site/domains/1/refresh`, {}],
      ["DELETE", `/communities/${pub}/site/domains/1`],
      ["GET", `/communities/${pub}/site/professionals`],
      ["POST", `/communities/${pub}/site/professionals`, { username: B.username }],
      ["DELETE", `/communities/${pub}/site/professionals/${M.id_user}`],
      ["POST", `/communities/${pub}/site/media`, {}],
    ];
    for (const [m, p, body] of WRITE) {
      r = await call(m, p, { token: tB, body: body ?? (m === "GET" ? undefined : {}) });
      check(`B: ${m} ${p.replace(pub, ":c")} recusado`, r.status >= 400, `veio ${r.status}`);
    }
    const after = (await pool.query(`SELECT site_name, is_published FROM tb_community_site WHERE id_profile=$1`, [pub])).rows[0];
    check("banco: site da A intacto (nome e publicação)", after.site_name === before.site_name && after.is_published === true);
    const slugNow = (await pool.query(`SELECT community_site_slug FROM tb_profile WHERE id_profile=$1`, [pub])).rows[0].community_site_slug;
    check("banco: endereço da A intacto", slugNow === slugPub, slugNow);
    check("banco: M continua na equipe (B não remove)", await CommunityProfessionalStorage.exists(pool, pub, M.id_user));
    const domains = await pool.query(`SELECT 1 FROM tb_community_domain WHERE id_profile=$1`, [pub]);
    check("banco: B não cadastrou domínio na comunidade da A", domains.rowCount === 0);

    r = await call("GET", `/communities/${draft}/site`, { token: tB });
    check("rascunho não existe para B", r.status === 200 && r.body?.exists === false && r.body?.config === null && !r.body?.services, JSON.stringify(r.body).slice(0, 200));
    r = await call("GET", `/communities/${draft}/site`);
    check("rascunho não existe para anônimo", r.status === 200 && r.body?.exists === false && r.body?.config === null);
    r = await call("POST", `/communities/${draft}/site/publish`, { token: tA, body: { published: true } });
    check("líder sem plano não publica (gate de plano)", r.status >= 400 && r.status !== 500, `veio ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    const draftRow = (await pool.query(`SELECT is_published FROM tb_community_site WHERE id_profile=$1`, [draft])).rows[0];
    check("banco: rascunho segue despublicado", draftRow.is_published === false);

    // ═══ 2. site publicado ══════════════════════════════════════════════
    console.log("\n━━━ 2. site publicado: projeção e trava ━━━");
    r = await call("GET", `/communities/site/by-slug/${slugPub}`);
    check("site público abre sem login", r.status === 200 && r.body?.locked === false, `veio ${r.status}`);
    const pubBody = r.body || {};
    const svc = pubBody.services || [];
    check("vitrine traz os serviços da equipe", svc.some((s) => s.name === `Barba M ${tag}`) && svc.some((s) => s.name === `Corte A ${tag}`), JSON.stringify(svc.map((s) => s.name)));
    check("serviço sem régua de comissão", svc.every((s) => FORBIDDEN_SERVICE_KEYS.every((k) => !(k in s))), JSON.stringify(svc[0]));
    const pros = pubBody.professionals || [];
    check("equipe sem dado pessoal (e-mail, CPF, telefone…)", pros.length > 0 && pros.every((p) => FORBIDDEN_PERSON_KEYS.every((k) => !(k in p))), JSON.stringify(pros[0]));
    check("nenhum e-mail no payload público do site", !String(r.text).includes("@t.test"));
    r = await call("GET", `/communities/${pub}/site`, { token: tB });
    check("leitura logada (B) do site público = mesma projeção", r.status === 200 && !String(r.text).includes("@t.test") && r.body?.is_leader === false && !("has_offer" in (r.body || {})));

    r = await call("GET", `/communities/site/by-slug/${slugPriv}`);
    check("site da privada: anônimo vê trancado", r.status === 200 && r.body?.locked === true && r.body?.config === null && !r.body?.services, JSON.stringify(r.body).slice(0, 200));
    r = await call("GET", `/communities/${priv}/site`, { token: tB });
    check("site da privada: B (de fora) vê trancado", r.status === 200 && r.body?.locked === true && r.body?.config === null && !r.body?.services, JSON.stringify(r.body).slice(0, 200));
    r = await call("GET", `/communities/${priv}/site/next-slot`, { token: tB });
    check("site da privada: próximo horário não sai para B", r.status === 200 && r.body?.slot === null, JSON.stringify(r.body));

    // ═══ 3. equipe: quem sai da comunidade sai do site (A1-18) ═══════════
    console.log("\n━━━ 3. equipe do site depois que M sai da comunidade (A1-18) ━━━");
    const originBefore = await BookingAlertService.resolveOrigin(pool, pub, M.id_user);
    check("enquanto é membro, M carimba a origem da reserva", originBefore?.id_community === pub);
    r = await call("POST", `/communities/${pub}/leave`, { token: tM, body: {} });
    check("M sai da comunidade", r.status < 300, `veio ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    r = await call("GET", `/communities/site/by-slug/${slugPub}`);
    const prosAfter = (r.body?.professionals || []).map((p) => String(p.id_profile));
    check("site público não mostra mais M", !prosAfter.includes(String(M.id_profile)), JSON.stringify(prosAfter));
    check("nem os serviços de M", !(r.body?.services || []).some((s) => s.name === `Barba M ${tag}`));
    const originAfter = await BookingAlertService.resolveOrigin(pool, pub, M.id_user);
    check("reserva na agenda de M não avisa mais o líder (origem nula)", originAfter === null, JSON.stringify(originAfter));
    await CommunityStorage.addMember(pool, pub, M.id_user, "member");
    check("quem volta à comunidade volta à equipe", await CommunityProfessionalStorage.exists(pool, pub, M.id_user));

    // ═══ 4. agenda da A ═════════════════════════════════════════════════
    console.log("\n━━━ 4. agenda da A, vista por B ━━━");
    const AG = [
      ["GET", `/profile/${A.id_profile}/availability`],
      ["POST", `/profile/${A.id_profile}/availability`, { rules: [] }],
      ["GET", `/profile/${A.id_profile}/availability-overrides`],
      ["POST", `/profile/${A.id_profile}/availability-overrides`, { override_date: overrideDate, is_day_blocked: false }],
      ["DELETE", `/profile/${A.id_profile}/availability-overrides/${override.id}`],
      ["GET", `/profile/${A.id_profile}/booking-settings`],
      ["POST", `/profile/${A.id_profile}/booking-settings`, { allow_on_site: true }],
      ["GET", `/profile/${A.id_profile}/bookings`],
      ["GET", `/profile/${A.id_profile}/calendar/week?weekStart=${overrideDate}&weekEnd=${overrideDate}`],
      ["PATCH", `/public/profile/bookings/${booking.id}/status`, { status: "canceled" }],
    ];
    for (const [m, p, body] of AG) {
      r = await call(m, p, { token: tB, body: body ?? (m === "GET" ? undefined : {}) });
      check(`B: ${m} ${p.replace(A.id_profile, ":p")} recusado`, r.status >= 400 && r.status !== 500, `veio ${r.status}`);
      check(`  …e sem o nome do cliente na resposta`, !String(r.text).includes("Cliente Sigiloso"));
    }
    // A porta do próprio perfil com o id da exceção da A: o WHERE prende ao dono.
    r = await call("DELETE", `/profile/${B.id_profile}/availability-overrides/${override.id}`, { token: tB });
    check("B não apaga exceção da A pela URL do próprio perfil", r.status >= 400, `veio ${r.status}`);
    const ov = await pool.query(`SELECT 1 FROM tb_profile_availability_overrides WHERE id=$1`, [override.id]);
    check("banco: exceção da A segue de pé", ov.rowCount === 1);
    const bk = (await pool.query(`SELECT status FROM tb_profile_bookings WHERE id=$1`, [booking.id])).rows[0];
    check("banco: reserva da A segue confirmada", bk.status === "confirmed", bk.status);
    r = await call("GET", `/public/profile/my-bookings`, { token: tB });
    check("my-bookings de B não traz a reserva da A", r.status === 200 && !String(r.text).includes("Cliente Sigiloso"));

    const bkDate = String(booking.booking_date instanceof Date ? booking.booking_date.toISOString() : booking.booking_date).slice(0, 10);
    r = await call("GET", `/public/profile/${A.id_profile}/calendar/week?weekStart=${bkDate}&weekEnd=${bkDate}`);
    const ev = (r.body?.events || []);
    check("semana pública mostra o horário ocupado", r.status === 200 && ev.length >= 1, JSON.stringify(r.body).slice(0, 200));
    check("…como \"Reservado\", sem nome, e-mail, telefone nem meta", ev.every((e) => e.title === "Reservado" && e.meta === undefined) && !/Sigiloso|sigiloso|99999/.test(r.text));
    r = await call("GET", `/profile/${A.id_profile}/calendar/week?weekStart=${bkDate}&weekEnd=${bkDate}`, { token: tA });
    check("a semana do dono mostra o cliente (controle)", r.status === 200 && String(r.text).includes("Cliente Sigiloso"));
    r = await call("GET", `/profile/${A.id_profile}/bookings`, { token: tA });
    check("a lista do dono traz a reserva (controle)", r.status === 200 && String(r.text).includes("Cliente Sigiloso"));

    // ═══ 5. confirmação por token ═══════════════════════════════════════
    console.log("\n━━━ 5. confirmação por token ━━━");
    r = await call("GET", `/bookings/confirm/nao-e-uuid`);
    check("token inválido = 400", r.status === 400, `veio ${r.status}`);
    r = await call("GET", `/bookings/confirm/${crypto.randomUUID()}`);
    check("token inventado = 404", r.status === 404, `veio ${r.status}`);
    // O token nasce no lembrete (`crypto.randomUUID`, BookingReminderService);
    // grava do mesmo jeito que ele.
    const tok = crypto.randomUUID();
    await require("../src/storages/BookingReminderStorage").markReminderSent(pool, booking.id, tok);
    r = await call("GET", `/bookings/confirm/${tok}`);
    const keys = Object.keys(r.body?.booking || {}).sort().join(",");
    check("token certo abre só os seis campos (sem e-mail/telefone)", r.status === 200 && keys === "booking_date,client_confirm_status,client_name,pro_name,start_time,status", keys);

    // ═══ 6. admin ═══════════════════════════════════════════════════════
    console.log("\n━━━ 6. usuário comum em rota de admin do lote → 403 ━━━");
    const ADMIN_ROUTES = [
      ["GET", "/admin/managed-sites"], ["GET", "/admin/managed-sites/requests"], ["GET", "/admin/managed-sites/templates"],
      ["GET", `/admin/managed-sites/${pub}`],
      ["GET", "/admin/booking-payouts"], ["POST", "/admin/booking-payouts/1/mark-paid"],
      ["GET", "/admin/booking-fees"], ["POST", "/admin/site-assets/hero"], ["DELETE", "/admin/site-assets/hero"], ["POST", "/admin/site-texts/hero"],
    ];
    for (const [m, p] of ADMIN_ROUTES) {
      r = await call(m, p, { token: tB, body: m === "GET" ? undefined : {} });
      check(`${m} ${p.replace(pub, ":c")} com conta comum = 403`, r.status === 403, `veio ${r.status}`);
    }
  } finally {
    server.close();
    for (const f of prevFlags) {
      await pool.query(`UPDATE tb_feature_flag SET is_enabled = $2 WHERE flag_key = $1`, [f.flag_key, f.is_enabled]).catch(() => {});
    }
    await pool.query(`DELETE FROM tb_profile_bookings WHERE profile_owner_user_id = ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.query(`DELETE FROM tb_profile_availability_overrides WHERE id = $1`, [override.id]).catch(() => {});
    await pool.query(`DELETE FROM tb_community_professional WHERE id_profile = ANY($1::uuid[])`, [communities]).catch(() => {});
    await pool.query(`DELETE FROM tb_community_site WHERE id_profile = ANY($1::uuid[])`, [communities]).catch(() => {});
    await pool.query(`DELETE FROM tb_profile WHERE id_profile = ANY($1::uuid[])`, [communities]).catch(() => {});
    await pool.query(`DELETE FROM tb_profile_service WHERE id_profile IN (SELECT id_profile FROM tb_profile WHERE id_user = ANY($1::uuid[]))`, [users]).catch(() => {});
    await pool.query(`DELETE FROM tb_user WHERE id_user = ANY($1::uuid[])`, [users]).catch(() => {});
    await pool.end();
  }

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
