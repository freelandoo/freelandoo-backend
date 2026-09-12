// test/whatsapp-cloud-webhook.e2e.js
// W2 — a rota do webhook da Cloud API, com HTTP de verdade.
//
// `npm run test:whatsapp-cloud-webhook`
//
// ─── POR QUE ISTO NÃO CABE NO UNIT ──────────────────────────────────────────
//
// O unit prova que `isValidSignature` calcula certo. O que ele NÃO consegue
// provar é a coisa mais fácil de errar aqui: que os BYTES CRUS chegam intactos
// até a conferência.
//
// Basta alguém trocar `express.raw()` por `express.json()` na rota — ou montar
// o `/webhooks` depois do `express.json()` global no app.js — para o corpo ser
// consumido e re-serializado. A assinatura passa a nunca bater, o unit continua
// verde, e o sintoma é 401 em tudo. A "correção" tentadora nesse ponto é
// desligar a checagem, o que devolve uma rota pública que aceita qualquer corpo
// da internet.
//
// Por isso este teste sobe o app DE VERDADE e faz requisições HTTP reais.
//
// ⚠️ NÃO TOCA O BANCO, de propósito: todos os casos param antes da ingestão
// (assinatura recusada, envelope sem mudanças, campo que não é de conversa).
// Assim ele roda em qualquer máquina, sem Postgres e sem risco de escrever em
// lugar nenhum.

process.env.NODE_ENV = "test";
process.env.META_APP_SECRET = "segredo-de-teste-w2";
process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-de-teste-w2";

const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");

const app = require("../src/app");

const SECRET = process.env.META_APP_SECRET;
const VERIFY = process.env.META_WEBHOOK_VERIFY_TOKEN;
const PATH = "/webhooks/whatsapp-cloud";

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.error(`  FAIL ${name}\n       ${e.message}`);
  }
}

function sign(raw, secret = SECRET) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
}

function request(server, { method, path, headers = {}, body }) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    /* ── GET: handshake da inscrição ────────────────────────────────────── */

    const q = (t, c) =>
      `${PATH}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(t)}&hub.challenge=${c}`;

    const okGet = await request(server, { method: "GET", path: q(VERIFY, "desafio123") });
    check("GET com token certo devolve 200", () => assert.strictEqual(okGet.status, 200));
    check("GET devolve o challenge em TEXTO PURO", () => {
      // Devolver JSON aqui faz a Meta recusar a URL sem dizer por quê.
      assert.strictEqual(okGet.body, "desafio123");
      assert.match(String(okGet.headers["content-type"] || ""), /text\/plain/);
    });

    const badGet = await request(server, { method: "GET", path: q("token-errado", "desafio123") });
    check("GET com token errado devolve 403", () => assert.strictEqual(badGet.status, 403));
    check("GET recusado NÃO devolve o challenge", () =>
      assert.ok(!badGet.body.includes("desafio123"))
    );

    const noMode = await request(server, {
      method: "GET",
      path: `${PATH}?hub.verify_token=${VERIFY}&hub.challenge=x`,
    });
    check("GET sem hub.mode devolve 403", () => assert.strictEqual(noMode.status, 403));

    /* ── POST: assinatura sobre os bytes crus ───────────────────────────── */

    // Envelope válido que NÃO chega à ingestão: sem `entry` não há bloco, e o
    // service devolve "ignorado" antes de qualquer consulta.
    const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const json = { "content-type": "application/json" };

    const signed = await request(server, {
      method: "POST",
      path: PATH,
      headers: { ...json, "x-hub-signature-256": sign(payload) },
      body: payload,
    });
    check("POST assinado corretamente devolve 200", () => assert.strictEqual(signed.status, 200));
    check("⚠️ o corpo CRU sobreviveu até o HMAC", () => {
      // Este é o caso que pega `express.json()` no lugar de `express.raw()`.
      // Se o corpo fosse re-serializado, a assinatura não bateria e isto seria
      // 401 — com todo o resto da suíte ainda verde.
      assert.strictEqual(
        signed.status,
        200,
        "401 aqui significa que o corpo foi consumido antes da conferência"
      );
      assert.match(signed.body, /"received":true/);
    });

    const tampered = await request(server, {
      method: "POST",
      path: PATH,
      headers: { ...json, "x-hub-signature-256": sign(payload) },
      body: JSON.stringify({ object: "whatsapp_business_account", entry: [], extra: 1 }),
    });
    check("POST com corpo adulterado devolve 401", () =>
      assert.strictEqual(tampered.status, 401)
    );

    const wrongSecret = await request(server, {
      method: "POST",
      path: PATH,
      headers: { ...json, "x-hub-signature-256": sign(payload, "outro-segredo") },
      body: payload,
    });
    check("POST assinado com outro segredo devolve 401", () =>
      assert.strictEqual(wrongSecret.status, 401)
    );

    const unsigned = await request(server, {
      method: "POST",
      path: PATH,
      headers: json,
      body: payload,
    });
    check("POST SEM assinatura devolve 401", () => assert.strictEqual(unsigned.status, 401));

    const garbageSig = await request(server, {
      method: "POST",
      path: PATH,
      headers: { ...json, "x-hub-signature-256": "sha256=nao-e-hex" },
      body: payload,
    });
    check("POST com assinatura malformada devolve 401, não 500", () =>
      // `timingSafeEqual` lança com tamanhos diferentes: sem a validação do
      // formato, um header de lixo derrubaria a rota com exceção.
      assert.strictEqual(garbageSig.status, 401)
    );

    /* ── POST: corpo torto nunca gera reentrega infinita ────────────────── */

    const notJson = "isto nao e json";
    const broken = await request(server, {
      method: "POST",
      path: PATH,
      headers: { ...json, "x-hub-signature-256": sign(notJson) },
      body: notJson,
    });
    check("corpo não-JSON devolve 200 (nunca vai virar JSON numa reentrega)", () =>
      assert.strictEqual(broken.status, 200)
    );

    /* ── POST: campo que não é conversa é ignorado sem tocar o banco ───── */

    const quality = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              field: "phone_number_quality_update",
              value: { metadata: { phone_number_id: "999" } },
            },
          ],
        },
      ],
    });
    const q2 = await request(server, {
      method: "POST",
      path: PATH,
      headers: { ...json, "x-hub-signature-256": sign(quality) },
      body: quality,
    });
    check("mudança de qualidade é aceita e ignorada (é do W6)", () => {
      assert.strictEqual(q2.status, 200);
      assert.match(q2.body, /phone_number_quality_update/);
    });

    /* ── a rota da Evolution continua intacta ──────────────────────────── */

    const evo = await request(server, {
      method: "POST",
      path: "/webhooks/whatsapp",
      headers: json,
      body: JSON.stringify({ event: "x", instance: "y" }),
    });
    check("⚠️ /webhooks/whatsapp (Evolution) NÃO foi capturada pela rota nova", () =>
      // Se a Cloud tivesse tomado o caminho `/whatsapp`, este POST sem
      // `x-hub-signature-256` viraria 401 em vez da resposta do Evolution.
      assert.notStrictEqual(evo.status, 401)
    );
  } finally {
    await new Promise((r) => server.close(r));
  }

  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
