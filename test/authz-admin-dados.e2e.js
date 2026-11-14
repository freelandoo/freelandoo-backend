// test/authz-admin-dados.e2e.js — Segurança A1, lote 7 (admin), parte 2: o que o admin VÊ e o que fica REGISTRADO.
//
//   npm run test:authz:admin-dados   (ou `npm run test:authz`, que roda os lotes)
//
// A parte 1 (authz-admin) prova que toda rota de admin tem a trava de papel. Esta prova o resto:
//   §1 segredo na resposta: semeia valores-SENTINELA em toda coluna secreta do banco (hash de senha,
//      tokens de reset/ativação/primeiro acesso, chave de API, segredo de webhook, chaves seladas de IA,
//      WhatsApp, academia, PIX, documento, perfil de personalidade) e CPFs inteiros; chama TODA rota GET de
//      admin (árvore real, parâmetros trocados pelos ids semeados) como administrador e confere que nenhuma
//      resposta traz a sentinela, o CPF inteiro, um campo com nome de segredo ou um token de sessão (JWT).
//   §2 trilha: ação de admin que muda algo vira linha em tb_admin_audit_log (quem, método, caminho,
//      status, corpo) com segredo do corpo trocado por "[oculto]"; GET e recusa não gravam; a porta do
//      JOGADOR do Meu Mundo não grava, a FERRAMENTA grava.
//   §3 admin não vira outro usuário: nenhuma rota de admin emite sessão; ninguém mexe no próprio papel.
// Contra o Postgres LOCAL de teste (porta 55432).
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
  if (cond) PASS++;
  else {
    FAIL++;
    console.log(`  ✗ ${label}${extra ? " — " + extra : ""}`);
  }
}
const uid = () => crypto.randomBytes(4).toString("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── anotar o prefixo de cada roteador ANTES de carregar o app (igual ao authz-admin) ─────────
const express = require("express");
const Router = require("router");
function tagUse(orig) {
  return function (...args) {
    const before = this.stack ? this.stack.length : (this.router?.stack?.length ?? 0);
    const out = orig.apply(this, args);
    const stack = this.stack || this.router?.stack;
    const mount = typeof args[0] === "string" ? args[0] : Array.isArray(args[0]) ? args[0][0] : "";
    if (stack) for (let i = before; i < stack.length; i++) stack[i].__mount = mount;
    return out;
  };
}
Router.prototype.use = tagUse(Router.prototype.use);
express.application.use = tagUse(express.application.use);

execFileSync(process.execPath, ["run-migrations.js"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env },
  stdio: "ignore",
});

const pool = require("../src/databases");
const app = require("../src/app");

function collect(stack, prefix, out) {
  for (const layer of stack || []) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) {
        for (const m of Object.keys(layer.route.methods)) {
          if (m === "_all") continue;
          out.push({ method: m.toUpperCase(), path: (prefix + p).replace(/\/+/g, "/") });
        }
      }
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      collect(layer.handle.stack, prefix + (layer.__mount || ""), out);
    }
  }
  return out;
}

async function call(base, method, p, token, body) {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${p}`, {
    method,
    headers: h,
    body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body ?? {}),
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* texto */
  }
  return { status: res.status, text, json };
}

const BCRYPT = (tag) => `$2b$10$${tag}`.padEnd(60, "x").slice(0, 60);
const SECRET_FIELD = /^(senha|password|password_hash|token_hash|partner_key_hash|webhook_secret|api_token_enc|api_key|access_token|refresh_token|[a-z_]*_sealed)$/i;
const JWT_SHAPE = /eyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{8,}/;

/** Caminhos de campos com nome de segredo num JSON. */
function secretFields(v, at = "", out = []) {
  if (!v || typeof v !== "object") return out;
  for (const [k, val] of Object.entries(v)) {
    const p = Array.isArray(v) ? `${at}[${k}]` : `${at}.${k}`;
    if (!Array.isArray(v) && SECRET_FIELD.test(k) && val !== null && val !== "" && val !== false) out.push(p);
    secretFields(val, p, out);
  }
  return out;
}

async function auditRows(where, params) {
  const r = await pool.query(
    `SELECT entity, entity_id, action, after_state, actor_user_id FROM tb_admin_audit_log WHERE entity = 'admin_http' AND ${where}`,
    params
  );
  return r.rows;
}
async function waitAudit(where, params, n = 1) {
  for (let i = 0; i < 40; i++) {
    const rows = await auditRows(where, params);
    if (rows.length >= n) return rows;
    await sleep(50);
  }
  return auditRows(where, params);
}

(async () => {
  const users = [];
  const cleanup = [];
  let server;
  const SENT = `SENTINELA${uid()}`;
  const CPF_USER = "98765432100";
  const CPF_MEMBER = "11144477735";
  const flagsBefore = (await pool.query(`SELECT flag_key, is_enabled FROM tb_feature_flag`)).rows;
  await pool.query(`UPDATE tb_feature_flag SET is_enabled = TRUE`);
  try {
    async function createUser(nome, extra = {}) {
      const r = await pool.query(
        `INSERT INTO tb_user (nome, username, email, senha, data_nascimento, ativo, cpf)
         VALUES ($1,$2,$3,$4,'1990-01-01',TRUE,$5) RETURNING id_user, email`,
        [nome, `authzdad${uid()}`, `authzdad${uid()}@t.test`, extra.senha || BCRYPT("comumcomumcomumcomumcomu"), extra.cpf || null]
      );
      users.push(r.rows[0]);
      return r.rows[0];
    }
    const comum = await createUser("Conta Comum");
    const adm = await createUser("Conta Admin");
    const vit = await createUser("Conta Vitima", { senha: BCRYPT(SENT), cpf: CPF_USER });
    const role = await pool.query(`SELECT id_role FROM tb_role WHERE desc_role = 'Administrator' LIMIT 1`);
    await pool.query(`INSERT INTO tb_user_role (id_user, id_role, is_active) VALUES ($1,$2,TRUE)`, [adm.id_user, role.rows[0].id_role]);
    await pool.query(`UPDATE tb_user SET is_admin = TRUE WHERE id_user = $1`, [adm.id_user]);
    const tokenOf = (u) => jwt.sign({ id_user: u.id_user, email: u.email }, process.env.JWT_SECRET, { expiresIn: "1h" });
    const [tC, tA] = [comum, adm].map(tokenOf);

    // ── sementes: uma sentinela em cada coluna secreta ────────────────────────────
    const seeds = {};
    async function seed(nome, sql, params) {
      try {
        const r = await pool.query(sql, params);
        seeds[nome] = r.rows[0] || true;
      } catch (e) {
        seeds[nome] = null;
        check(`semente entrou: ${nome}`, false, e.message);
      }
    }
    const prof = await pool.query(
      `INSERT INTO tb_profile (id_user, id_category, display_name, sub_profile_slug, is_active, is_visible, is_user_account)
       VALUES ($1, (SELECT id_category FROM tb_category ORDER BY id_category LIMIT 1), 'Perfil Vitima', $2, TRUE, TRUE, TRUE)
       RETURNING id_profile`,
      [vit.id_user, `vit-${uid()}`]
    );
    const id_profile = prof.rows[0].id_profile;
    await seed("reset de senha", `INSERT INTO tb_user_password_reset (id_user, token, expires_at) VALUES ($1,$2,NOW()+interval '1 hour') RETURNING 1`, [vit.id_user, `${SENT}reset`]);
    await seed("ativação", `INSERT INTO tb_user_activation (id_user, token, expires_at) VALUES ($1,$2,NOW()+interval '1 hour') RETURNING 1`, [vit.id_user, `${SENT}ativ`]);
    await seed("primeiro acesso", `INSERT INTO tb_user_first_access (id_user, token_hash, expira_em) VALUES ($1,$2,NOW()+interval '1 hour') RETURNING 1`, [vit.id_user, `${SENT}primeiro`]);
    await seed(
      "chave de API",
      `INSERT INTO tb_api_connection (id_user, name, token_hash, token_prefix, webhook_secret) VALUES ($1,'Chave',$2,'flnd_atd_x',$3) RETURNING 1`,
      [vit.id_user, `${SENT}tokenhash`, `${SENT}whsecret`]
    );
    const aiBefore = await pool.query(`SELECT 1 FROM tb_ai_provider_key WHERE provider = 'openai'`);
    if (!aiBefore.rowCount) {
      await seed("chave de IA", `INSERT INTO tb_ai_provider_key (provider, api_key_sealed, key_hint, model) VALUES ('openai',$1,'…abcd','gpt-x') RETURNING 1`, [`${SENT}aikey`]);
      cleanup.push(() => pool.query(`DELETE FROM tb_ai_provider_key WHERE provider = 'openai'`));
    }
    await seed(
      "WhatsApp",
      `INSERT INTO tb_whatsapp_instance (id_user, evolution_instance, provider, access_token_sealed) VALUES ($1,$2,'cloud',$3) RETURNING id_instance`,
      [vit.id_user, `pn${uid()}`, `${SENT}watoken`]
    );
    await seed(
      "academia",
      `INSERT INTO tb_academy (id_owner_user, nome, slug, api_base_url, api_token_enc, partner_key_hash, whatsapp_webhook_secret_sealed)
       VALUES ($1,'Academia Vitima',$2,'https://academia.test',$3,$4,$5) RETURNING id_academy`,
      [vit.id_user, `acad${uid()}`, `${SENT}acadtoken`, `${SENT}parckey`, `${SENT}acadwh`]
    );
    const id_academy = seeds.academia?.id_academy;
    if (id_academy) {
      await seed("aluno da academia", `INSERT INTO tb_academy_member (id_academy, id_user, cpf) VALUES ($1,$2,$3) RETURNING 1`, [id_academy, comum.id_user, CPF_MEMBER]);
      await seed(
        "conta PIX da academia",
        `INSERT INTO tb_academy_payout_account (id_academy, pix_key_type, pix_key_sealed, pix_key_hint, holder_name, holder_doc_type, holder_doc_sealed, holder_doc_hint)
         VALUES ($1,'random',$2,'…x','Titular','cpf',$3,'…00') RETURNING 1`,
        [id_academy, `${SENT}pix`, `${SENT}doc`]
      );
    }
    await seed("perfil de personalidade", `INSERT INTO tb_personality_profile (id_user, payload_sealed, consent_version) VALUES ($1,$2,'v1') RETURNING 1`, [vit.id_user, `${SENT}perso`]);
    await seed(
      "domínio de site",
      `INSERT INTO tb_community_domain (id_profile, domain, verification_token) VALUES ($1,$2,$3) RETURNING 1`,
      [id_profile, `vit${uid()}.test`, `${SENT}dominio`]
    );

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    // ── §1 nenhuma rota GET de admin devolve segredo ───────────────────────────────
    console.log("\n▶ §1 segredo na resposta (todas as rotas GET de admin, como administrador)");
    const all = collect(app.router.stack, "", []);
    const seen = new Set();
    const gets = all.filter((r) => {
      if (r.method !== "GET" || !/admin|^\/role|^\/itens|^\/residences\/proofs|^\/legalDocuments/i.test(r.path)) return false;
      if (seen.has(r.path)) return false;
      seen.add(r.path);
      return true;
    });
    const fill = (p, cand) =>
      p
        .replace(/:(\w+)\(\\d\+\)/g, "1")
        .replace(/:(\w+)\??/g, (_, n) => {
          if (/user/i.test(n)) return vit.id_user;
          if (/profile|community/i.test(n)) return id_profile;
          if (/academy/i.test(n)) return id_academy || cand;
          return cand;
        })
        .replace(/\*\w*/g, "x")
        .replace(/\{[^}]*\}/g, "");
    let chamadas = 0;
    let com200 = 0;
    for (const r of gets) {
      const variants = /:/.test(r.path)
        ? [...new Set([vit.id_user, id_profile, id_academy, "1"].filter(Boolean).map((c) => fill(r.path, c)))]
        : [r.path, `${r.path}${r.path.includes("?") ? "&" : "?"}q=Vitima&search=Vitima&limit=200`];
      for (const u of variants) {
        const res = await call(base, "GET", u, tA);
        chamadas++;
        if (res.status === 200) com200++;
        check(`sem sentinela: GET ${u}`, !res.text.includes(SENT), res.text.slice(Math.max(0, res.text.indexOf(SENT) - 80), res.text.indexOf(SENT) + 40));
        check(`sem CPF inteiro: GET ${u}`, !res.text.includes(CPF_USER) && !res.text.includes(CPF_MEMBER));
        check(`sem token de sessão: GET ${u}`, !JWT_SHAPE.test(res.text));
        const campos = secretFields(res.json);
        check(`sem campo de segredo: GET ${u}`, campos.length === 0, campos.slice(0, 5).join(", "));
      }
    }
    console.log(`  ${gets.length} rotas, ${chamadas} chamadas (${com200} com 200)`);
    check("a varredura chegou nas telas (muitas rotas responderam 200)", com200 > 80, String(com200));
    // a lista de usuários do admin mostra a vítima (a varredura viu dado de verdade, não lista vazia)
    const lista = await call(base, "GET", "/admin/users", tA);
    check("lista de usuários do admin traz a conta semeada", lista.status === 200 && lista.text.includes(vit.id_user), String(lista.status));

    // ── §2 trilha das ações de admin ───────────────────────────────────────────────
    console.log("\n▶ §2 trilha das ações de admin (tb_admin_audit_log)");
    const desde = new Date();
    const promo = await call(base, "PATCH", `/admin/users/${vit.id_user}/admin`, tA, { is_admin: true });
    check("admin promove a vítima (200)", promo.status === 200, `${promo.status} ${promo.text.slice(0, 120)}`);
    let rows = await waitAudit(`entity_id = $1 AND action = 'PATCH' AND created_at >= $2`, [`/admin/users/${vit.id_user}/admin`, desde]);
    check("promover admin deixa linha na trilha", rows.length === 1, String(rows.length));
    check("a linha diz quem fez", rows[0]?.actor_user_id === adm.id_user, rows[0]?.actor_user_id);
    check("a linha guarda status e corpo", rows[0]?.after_state?.status === 200 && rows[0]?.after_state?.body?.is_admin === true, JSON.stringify(rows[0]?.after_state));
    const rebaixa = await call(base, "PATCH", `/admin/users/${vit.id_user}/admin`, tA, { is_admin: false });
    check("admin rebaixa a vítima (200)", rebaixa.status === 200, String(rebaixa.status));
    rows = await waitAudit(`entity_id = $1 AND action = 'PATCH' AND created_at >= $2`, [`/admin/users/${vit.id_user}/admin`, desde], 2);
    check("rebaixar também fica na trilha", rows.length === 2, String(rows.length));

    // só mexe na chave de IA quando a linha é do teste (banco compartilhado: não sobrescreve chave de outro)
    if (!aiBefore.rowCount) {
      const chave = `${SENT}chavenova`;
      const salvaChave = await call(base, "PUT", "/admin/ai/keys/openai", tA, { api_key: chave, model: "gpt-x" });
      rows = await waitAudit(`entity_id = '/admin/ai/keys/openai' AND action = 'PUT' AND created_at >= $1`, [desde]);
      check("trocar chave de IA fica na trilha", rows.length === 1, `${rows.length} (resposta ${salvaChave.status})`);
      check("a trilha NÃO guarda a chave", rows.length === 1 && !JSON.stringify(rows[0]).includes(chave) && rows[0].after_state?.body?.api_key === "[oculto]", JSON.stringify(rows[0]?.after_state?.body));
    } else {
      console.log("  (chave de IA já existia neste banco: troca de chave não testada aqui)");
    }

    const recusa = await call(base, "PATCH", `/admin/users/${vit.id_user}/admin`, tC, { is_admin: true });
    check("conta comum é recusada", recusa.status === 403, String(recusa.status));
    await call(base, "GET", "/admin/users", tA);
    await sleep(300);
    rows = await auditRows(`actor_user_id = $1`, [comum.id_user]);
    check("recusa não grava linha (só quem passou pela trava)", rows.length === 0, String(rows.length));
    rows = await auditRows(`action = 'GET' AND created_at >= $1`, [desde]);
    check("GET não grava linha", rows.length === 0, String(rows.length));

    // Meu Mundo: porta do jogador não grava; ferramenta grava
    await call(base, "POST", "/meu-mundo/admin/session", tA, {});
    await call(base, "POST", "/meu-mundo/admin/house/level", tA, { level: 1 });
    await sleep(300);
    rows = await auditRows(`entity_id = '/meu-mundo/admin/session' AND created_at >= $1`, [desde]);
    check("porta do jogador do Meu Mundo não vira trilha", rows.length === 0, String(rows.length));
    rows = await waitAudit(`entity_id = '/meu-mundo/admin/house/level' AND created_at >= $1`, [desde]);
    check("ferramenta do Meu Mundo vira trilha", rows.length === 1, String(rows.length));

    // ── §3 admin não vira outro usuário ────────────────────────────────────────────
    console.log("\n▶ §3 admin não vira outro usuário");
    const self = await call(base, "PATCH", `/admin/users/${adm.id_user}/admin`, tA, { is_admin: false });
    check("admin não mexe no próprio papel", self.status === 400, String(self.status));
    check("promover não devolve sessão nem senha", !JWT_SHAPE.test(promo.text) && secretFields(promo.json).length === 0, promo.text.slice(0, 160));
    const rotasSessao = all.filter((r) => /admin/i.test(r.path) && /(impersonat|login-?as|act-?as|sudo|token|session)/i.test(r.path) && !/^\/meu-mundo\/admin\/(session|polens\/purchase\/:session|players\/:session)$/.test(r.path));
    check("nenhuma rota de admin para entrar como outra pessoa", rotasSessao.length === 0, rotasSessao.map((r) => `${r.method} ${r.path}`).join(", "));
    const sessao = await call(base, "POST", "/meu-mundo/admin/session", tA, { id_user: vit.id_user });
    check("sessão do jogo não aceita id de outra conta", !sessao.text.includes(vit.id_user), sessao.text.slice(0, 160));
  } catch (e) {
    FAIL++;
    console.error(e);
  } finally {
    for (const f of flagsBefore) await pool.query(`UPDATE tb_feature_flag SET is_enabled=$2 WHERE flag_key=$1`, [f.flag_key, f.is_enabled]).catch(() => {});
    for (const c of cleanup) await c().catch(() => {});
    const ids = users.map((u) => u.id_user);
    if (ids.length) {
      await pool.query(`DELETE FROM tb_admin_audit_log WHERE actor_user_id = ANY($1::uuid[])`, [ids]).catch(() => {});
      for (const t of ["tb_user_password_reset", "tb_user_activation", "tb_user_first_access", "tb_api_connection", "tb_whatsapp_instance", "tb_personality_profile"]) {
        await pool.query(`DELETE FROM ${t} WHERE id_user = ANY($1::uuid[])`, [ids]).catch(() => {});
      }
      await pool.query(`DELETE FROM tb_academy WHERE id_owner_user = ANY($1::uuid[])`, [ids]).catch(() => {});
      await pool.query(`DELETE FROM tb_community_domain WHERE id_profile IN (SELECT id_profile FROM tb_profile WHERE id_user = ANY($1::uuid[]))`, [ids]).catch(() => {});
      await pool.query(`DELETE FROM tb_user_role WHERE id_user = ANY($1::uuid[])`, [ids]).catch(() => {});
      await pool.query(`DELETE FROM tb_profile WHERE id_user = ANY($1::uuid[])`, [ids]).catch(() => {});
      for (const id of ids) await pool.query(`DELETE FROM tb_user WHERE id_user = $1`, [id]).catch(() => {});
    }
    if (server) server.close();
    console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
    await pool.end().catch(() => {});
    process.exit(FAIL ? 1 : 0);
  }
})();
