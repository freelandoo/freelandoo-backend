// test/webhook-secret-sealed.e2e.js — Segurança A6: segredo de assinatura do webhook guardado selado.
//
//   npm run test:webhook-secret
//
// 1. criar conexão grava `webhook_secret` SELADO (v1:…), não o texto;
// 2. ler pela chave (getActiveByTokenHash) e pelo setWebhookUrl devolve o texto original;
// 3. linha ANTIGA em texto puro: o despacho lê o texto certo e sela a linha na hora;
// 4. o reseal-secrets conhece as duas colunas (rotação da chave não as perde).
const url = process.env.TEST_DATABASE_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DATABASE_SSL = "false";
process.env.JWT_SECRET = process.env.JWT_SECRET_TEST || "segredo-de-teste";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
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
const ApiConnectionStorage = require("../src/storages/ApiConnectionStorage");
const WebhookDispatchService = require("../src/services/WebhookDispatchService");

(async () => {
  let idUser;
  try {
    const u = await pool.query(
      `INSERT INTO tb_user (nome, username, email, senha, data_nascimento, ativo) VALUES ('Sel', $1, $2, 'x', '1990-01-01', TRUE) RETURNING id_user`,
      [`sel${crypto.randomBytes(3).toString("hex")}`, `sel${Date.now()}@t.test`]
    );
    idUser = u.rows[0].id_user;
    const secret = "flwh_" + crypto.randomBytes(24).toString("base64url");
    const hash = crypto.randomBytes(16).toString("hex");

    console.log("\n▶ 1–2. conexão nova");
    const c = await ApiConnectionStorage.create(pool, { id_user: idUser, name: "teste", token_hash: hash, token_prefix: "flnd_atd_x", scope_personal: true, webhook_secret: secret });
    const raw = (await pool.query(`SELECT webhook_secret FROM public.tb_api_connection WHERE id_connection = $1`, [c.id_connection])).rows[0].webhook_secret;
    check("o banco guarda selado (v1:)", String(raw).startsWith("v1:"), String(raw).slice(0, 12));
    check("o texto do segredo não está no banco", !String(raw).includes(secret));
    const byKey = await ApiConnectionStorage.getActiveByTokenHash(pool, hash);
    check("getActiveByTokenHash devolve o texto", byKey && byKey.webhook_secret === secret);
    const upd = await ApiConnectionStorage.setWebhookUrl(pool, { id_connection: c.id_connection, webhook_url: "https://example.com/hook" });
    check("setWebhookUrl devolve o texto", upd && upd.webhook_secret === secret);

    console.log("\n▶ 3. linha antiga em texto puro");
    const old = "flwh_" + crypto.randomBytes(24).toString("base64url");
    await pool.query(`UPDATE public.tb_api_connection SET webhook_secret = $2 WHERE id_connection = $1`, [c.id_connection, old]);
    const list = await WebhookDispatchService._listForTest(idUser);
    check("o despacho lê o texto certo da linha antiga", list.length === 1 && list[0].webhook_secret === old, JSON.stringify(list.map((x) => x.webhook_secret)));
    const after = (await pool.query(`SELECT webhook_secret FROM public.tb_api_connection WHERE id_connection = $1`, [c.id_connection])).rows[0].webhook_secret;
    check("e sela a linha na hora", String(after).startsWith("v1:") && !after.includes(old));
    const again = await WebhookDispatchService._listForTest(idUser);
    check("depois de selada continua abrindo", again[0].webhook_secret === old);

    console.log("\n▶ 3b. fila de entrega (o worker assina com o texto)");
    const d = await ApiConnectionStorage.enqueueDelivery(pool, { id_connection: c.id_connection, event_type: "teste", payload: { a: 1 } });
    const due = (await ApiConnectionStorage.listDueDeliveries(pool, 500)).filter((x) => x.id_delivery === d.id_delivery);
    check("listDueDeliveries devolve o texto", due.length === 1 && due[0].webhook_secret === old);

    console.log("\n▶ 4. rotação");
    const reseal = fs.readFileSync(path.join(__dirname, "../scripts/reseal-secrets.js"), "utf8");
    check("reseal-secrets conhece tb_api_connection.webhook_secret", /tabela: "tb_api_connection", pk: "id_connection", coluna: "webhook_secret"/.test(reseal));
    check("reseal-secrets conhece tb_academy.whatsapp_webhook_secret_sealed", /coluna: "whatsapp_webhook_secret_sealed"/.test(reseal));
    const velho = "flwh_" + crypto.randomBytes(24).toString("base64url");
    await pool.query(`UPDATE public.tb_api_connection SET webhook_secret = $2 WHERE id_connection = $1`, [c.id_connection, velho]);
    execFileSync(process.execPath, ["scripts/reseal-secrets.js", "--apply"], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, SECRET_BOX_KEY: process.env.JWT_SECRET },
      stdio: "ignore",
    });
    const selado = (await pool.query(`SELECT webhook_secret FROM public.tb_api_connection WHERE id_connection = $1`, [c.id_connection])).rows[0].webhook_secret;
    check("reseal --apply sela a linha antiga em texto puro", String(selado).startsWith("v1:") && !selado.includes(velho));
    check("e ela abre no texto certo", (await ApiConnectionStorage.getActiveByTokenHash(pool, hash)).webhook_secret === velho);
  } catch (e) {
    FAIL++;
    console.error(e);
  } finally {
    if (idUser) {
      await pool
        .query(`DELETE FROM public.tb_api_webhook_delivery WHERE id_connection IN (SELECT id_connection FROM public.tb_api_connection WHERE id_user = $1)`, [idUser])
        .catch(() => {});
      await pool.query(`DELETE FROM public.tb_api_connection WHERE id_user = $1`, [idUser]).catch(() => {});
      await pool.query(`DELETE FROM tb_user WHERE id_user = $1`, [idUser]).catch(() => {});
    }
    console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
    await pool.end().catch(() => {});
    process.exit(FAIL ? 1 : 0);
  }
})();
