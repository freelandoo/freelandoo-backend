// test/authz-admin.e2e.js — Segurança A1, lote 7 (admin).
//
//   npm run test:authz:admin   (ou `npm run test:authz`, que roda os lotes)
//
// Pergunta: TODA rota de administração recusa quem não é administrador?
// Sem lista à mão: antes de carregar o app, o `use` do Express anota o prefixo de
// cada roteador montado; depois o teste percorre a árvore REAL de rotas e pega toda
// rota com "admin" no caminho completo. Cada uma é chamada pelo HTTP do app:
//   1. sem login        → tem de dar 401 (ou 403);
//   2. conta comum      → tem de parar na porta: 401/403. O 403 do `roleMiddleware`
//      ("permissão insuficiente") conta como certo; outro 403 (flag, plano, checagem
//      no controlador) é listado para conferência e só passa se estiver em
//      OUTRO_403_OK com o motivo;
//   3. administrador    → amostra: a porta deixa passar (não é 401/403 do papel).
// Todas as flags de função ficam LIGADAS durante o teste (uma flag desligada daria
// 403 e esconderia rota sem trava de papel); o estado volta no fim.
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

// ── 0. anotar o prefixo de cada roteador ANTES de carregar o app ─────────────
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
// a trava de papel ganha nome (roleGate): rota com ela entra na conferência mesmo sem "admin" no caminho
{
  const rmPath = require.resolve("../src/middlewares/roleMiddleware");
  const real = require(rmPath);
  require.cache[rmPath].exports = function roleMiddleware(roles) {
    const fn = real(roles);
    return Object.defineProperty((req, res, next) => fn(req, res, next), "name", { value: "roleGate" });
  };
}

execFileSync(process.execPath, ["run-migrations.js"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env },
  stdio: "ignore",
});

const pool = require("../src/databases");
const app = require("../src/app");

/** Toda rota da árvore real: { method, path, names } (names = nomes das funções da cadeia). */
function collect(stack, prefix, out, chain) {
  for (const layer of stack || []) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const names = [...chain, ...layer.route.stack.map((s) => s.handle?.name || s.name || "anon")];
      for (const p of paths) {
        for (const m of Object.keys(layer.route.methods)) {
          if (m === "_all") continue;
          out.push({ method: m.toUpperCase(), path: (prefix + p).replace(/\/+/g, "/"), names });
        }
      }
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      collect(layer.handle.stack, prefix + (layer.__mount || ""), out, [...chain]);
    } else if (layer.__mount === undefined || layer.__mount === "" || layer.__mount === "/") {
      // middleware solto no roteador: vale para as rotas dele que vêm depois
      chain.push(layer.handle?.name || "anon");
    }
  }
  return out;
}

/** Caminho com parâmetros → URL de verdade (um UUID para ids, 1 para o resto). */
function concrete(p) {
  return p
    .replace(/:id_?\w*\(\\d\+\)/g, "1")
    .replace(/:(\w+)\??/g, (_, n) => (/^id|_id$|^id_|uuid/i.test(n) ? "00000000-0000-4000-8000-000000000001" : "x"))
    .replace(/\*\w*/g, "x")
    .replace(/\{[^}]*\}/g, "");
}

// Outro 403 que NÃO é o do papel e está certo (rota de admin que confere o papel
// no próprio controlador, com mensagem própria). Formato: "MÉTODO caminho": motivo.
const OUTRO_403_OK = {};

async function call(base, method, p, token) {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${p}`, { method, headers: h, body: method === "GET" || method === "HEAD" ? undefined : "{}" });
  const text = await res.text();
  return { status: res.status, text: text.slice(0, 200) };
}

async function createUser(nome) {
  const r = await pool.query(
    `INSERT INTO tb_user (nome, username, email, senha, data_nascimento, ativo)
     VALUES ($1,$2,$3,'$2b$10$abcdefghijklmnopqrstuuJ1aJ0aB2cD3eF4gH5iJ6kL7mN8oP9q','1990-01-01',TRUE)
     RETURNING id_user, email`,
    [nome, `authzadm${uid()}`, `authzadm${uid()}@t.test`]
  );
  return r.rows[0];
}
const tokenOf = (u) => jwt.sign({ id_user: u.id_user, email: u.email }, process.env.JWT_SECRET, { expiresIn: "1h" });

(async () => {
  const users = [];
  let server;
  const flagsBefore = (await pool.query(`SELECT flag_key, is_enabled FROM tb_feature_flag`)).rows;
  await pool.query(`UPDATE tb_feature_flag SET is_enabled = TRUE`);
  try {
    const comum = await createUser("Conta Comum");
    const adm = await createUser("Conta Admin");
    users.push(comum, adm);
    const role = await pool.query(`SELECT id_role FROM tb_role WHERE desc_role = 'Administrator' LIMIT 1`);
    if (role.rows[0]) await pool.query(`INSERT INTO tb_user_role (id_user, id_role, is_active) VALUES ($1,$2,TRUE)`, [adm.id_user, role.rows[0].id_role]);
    const [tC, tA] = [comum, adm].map(tokenOf);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const all = collect(app.router.stack, "", [], []);
    const admin = all.filter((r) => /admin/i.test(r.path) || r.names.includes("roleGate"));
    const seen = new Set();
    const rotas = admin.filter((r) => {
      const k = r.method + " " + r.path;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const soPapel = rotas.filter((r) => !/admin/i.test(r.path)).length;
    console.log(`\n▶ ${all.length} rotas no app, ${rotas.length} de admin (${soPapel} sem "admin" no caminho, achadas pela trava)`);
    check("achou rotas de admin (o percurso da árvore funciona)", rotas.length > 50, String(rotas.length));

    const outros = [];
    for (const r of rotas) {
      const u = concrete(r.path);
      const anon = await call(base, r.method, u, null);
      check(`anônimo barrado: ${r.method} ${r.path}`, anon.status === 401 || anon.status === 403, `${anon.status} ${anon.text}`);
      const c = await call(base, r.method, u, tC);
      const k = `${r.method} ${r.path}`;
      if (c.status === 403 && /permissão insuficiente/.test(c.text)) {
        PASS++;
      } else if (c.status === 401 || c.status === 403) {
        outros.push(`${k} → ${c.status} ${c.text}`);
        check(`conta comum barrada pelo papel: ${k}`, !!OUTRO_403_OK[k], `${c.status} ${c.text} (cadeia: ${r.names.join(",")})`);
      } else {
        check(`conta comum barrada: ${k}`, false, `${c.status} ${c.text} (cadeia: ${r.names.join(",")})`);
      }
    }
    // amostra: o administrador passa pela porta (só GET, para não mexer em nada)
    const gets = rotas.filter((r) => r.method === "GET" && !/:/.test(r.path)).slice(0, 25);
    for (const r of gets) {
      const a = await call(base, "GET", r.path, tA);
      check(`admin passa a porta: GET ${r.path}`, !(a.status === 401 || (a.status === 403 && /permissão insuficiente/.test(a.text))), `${a.status} ${a.text}`);
    }
    if (outros.length) {
      console.log(`\n  403/401 que não é do papel (${outros.length}):`);
      for (const o of outros) console.log("   ·", o);
    }
  } catch (e) {
    FAIL++;
    console.error(e);
  } finally {
    for (const f of flagsBefore) await pool.query(`UPDATE tb_feature_flag SET is_enabled=$2 WHERE flag_key=$1`, [f.flag_key, f.is_enabled]).catch(() => {});
    for (const u of users) {
      await pool.query(`DELETE FROM tb_user_role WHERE id_user=$1`, [u.id_user]).catch(() => {});
      await pool.query(`DELETE FROM tb_user WHERE id_user=$1`, [u.id_user]).catch(() => {});
    }
    if (server) server.close();
    console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
    await pool.end().catch(() => {});
    process.exit(FAIL ? 1 : 0);
  }
})();
