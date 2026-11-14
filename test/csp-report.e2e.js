// test/csp-report.e2e.js — Segurança A4 (CSP): relatórios de violação agregados (mig 453).
//
//   npm run test:csp-report
//
// Pelo HTTP do app real, contra o Postgres LOCAL de teste (porta 55432):
//   1. report-uri (application/csp-report) e Reporting API (application/reports+json) gravam;
//   2. o mesmo par (diretiva, origem, página) soma em UMA linha;
//   3. sem dado pessoal: da URL bloqueada fica a ORIGEM, da página o CAMINHO (query some, id vira :id);
//   4. corpo que não é relatório → 204 e nada gravado; corpo grande → recusado;
//   5. GET /admin/csp-reports: sem login 401 (o lote 7 cobre conta comum).
const url = process.env.TEST_DATABASE_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DATABASE_SSL = "false";
process.env.JWT_SECRET = process.env.JWT_SECRET_TEST || "segredo-de-teste";
process.env.FRONTEND_URL = "https://freelandoo.test";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");

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

execFileSync(process.execPath, ["run-migrations.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env }, stdio: "ignore" });
const pool = require("../src/databases");
const app = require("../src/app");

(async () => {
  let server;
  try {
    await pool.query(`DELETE FROM public.tb_csp_report`);
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (type, body) => fetch(`${base}/csp-report`, { method: "POST", headers: { "Content-Type": type }, body: typeof body === "string" ? body : JSON.stringify(body) });

    console.log("\n▶ 1–3. os dois formatos, agregação e sem dado pessoal");
    const old = {
      "csp-report": {
        "document-uri": "https://www.freelandoo.com.br/perfil/123456789/fotos?token=segredo&email=a@b.c",
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://evil.example.com/x.js?session=abc",
      },
    };
    let r = await post("application/csp-report", old);
    check("report-uri → 204", r.status === 204, String(r.status));
    r = await post("application/csp-report", old);
    const newer = [{ type: "csp-violation", body: { documentURL: "https://www.freelandoo.com.br/meu-mundo", effectiveDirective: "connect-src", blockedURL: "wss://x.livekit.cloud/rtc" } }];
    r = await post("application/reports+json", newer);
    check("Reporting API → 204", r.status === 204, String(r.status));
    const rows = (await pool.query(`SELECT directive, blocked, page, hits FROM public.tb_csp_report ORDER BY directive`)).rows;
    const s = rows.find((x) => x.directive === "script-src-elem");
    check("o mesmo relatório soma numa linha (hits 2)", s && s.hits === 2, JSON.stringify(rows));
    check("da URL bloqueada fica só a origem", s && s.blocked === "https://evil.example.com", s && s.blocked);
    check("da página fica o caminho, sem query, com :id", s && s.page === "/perfil/:id/fotos", s && s.page);
    check("nenhum token/e-mail gravado", !JSON.stringify(rows).match(/segredo|a@b\.c|session=abc/));
    const c = rows.find((x) => x.directive === "connect-src");
    check("Reporting API gravou connect-src com a origem wss", c && c.blocked === "wss://x.livekit.cloud" && c.page === "/meu-mundo", JSON.stringify(c));

    console.log("\n▶ 4. lixo e corpo grande");
    const before = (await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_csp_report`)).rows[0].n;
    r = await post("application/json", { qualquer: "coisa" });
    check("corpo que não é relatório → 204", r.status === 204, String(r.status));
    r = await post("application/csp-report", "{nao e json");
    check("JSON quebrado não derruba (4xx)", r.status >= 400 && r.status < 500, String(r.status));
    r = await post("application/csp-report", { "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://a.b/" + "x".repeat(20000), "document-uri": "https://f/" } });
    check("corpo acima de 16 KB recusado (413)", r.status === 413, String(r.status));
    const after = (await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_csp_report`)).rows[0].n;
    check("nada gravado pelo lixo", after === before, `${before} → ${after}`);

    console.log("\n▶ 5. leitura do admin");
    r = await fetch(`${base}/admin/csp-reports`);
    check("sem login → 401", r.status === 401, String(r.status));
  } catch (e) {
    FAIL++;
    console.error(e);
  } finally {
    await pool.query(`DELETE FROM public.tb_csp_report`).catch(() => {});
    if (server) server.close();
    console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
    await pool.end().catch(() => {});
    process.exit(FAIL ? 1 : 0);
  }
})();
