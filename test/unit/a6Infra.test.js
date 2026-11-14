// Segurança A6 — borda do back: erro sem detalhe interno, URL com chave fora do
// log, webhook inseguro desligado em produção.
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const express = require("express");

const { redactUrl, redactPath } = require("../../src/utils/redactUrl");
const { errorHandler, notFound } = require("../../src/middlewares/errorHandler");

test("redactUrl esconde a chave do link e mantém a forma", () => {
  const hex = "a".repeat(64);
  assert.strictEqual(redactUrl(`/auth/primeiro-acesso/${hex}`), "/auth/primeiro-acesso/[oculto]");
  assert.strictEqual(
    redactUrl("/bookings/confirm/8f14e45f-ceea-467f-a8b0-123456789abc"),
    "/bookings/confirm/[oculto]"
  );
  assert.strictEqual(redactUrl("/public/classificacao/link/AbC_dEf-123"), "/public/classificacao/link/[oculto]");
  assert.strictEqual(redactUrl(`/qualquer/${hex}/x`), "/qualquer/[oculto]/x");
  assert.strictEqual(
    redactUrl(`/auth/activate?token=${hex}&lang=pt`),
    "/auth/activate?token=[oculto]&lang=pt"
  );
  assert.strictEqual(redactUrl("/x?hub.verify_token=s&hub.challenge=c&page=2"), "/x?hub.verify_token=[oculto]&hub.challenge=[oculto]&page=2");
  // O que não é segredo passa igual.
  assert.strictEqual(redactUrl("/profile/8f14e45f-ceea-467f-a8b0-123456789abc?page=2"), "/profile/8f14e45f-ceea-467f-a8b0-123456789abc?page=2");
  assert.strictEqual(redactPath("/communities/padaria-do-ze/site-events"), "/communities/padaria-do-ze/site-events");
  assert.strictEqual(redactUrl(""), "");
});

async function withApp(thrower, fn) {
  const app = express();
  app.get("/boom", (req, res, next) => next(thrower()));
  app.use(notFound);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    server.close();
  }
}

function pgError(code, message) {
  const e = new Error(message);
  e.code = code;
  e.severity = "ERROR";
  e.routine = "x";
  return e;
}

test("erro do banco com id torto vira 400 sem o texto do Postgres", async () => {
  await withApp(
    () => pgError("22P02", 'invalid input syntax for type uuid: "abc"'),
    async (base) => {
      const r = await fetch(`${base}/boom`);
      assert.strictEqual(r.status, 400);
      const body = await r.json();
      assert.strictEqual(body.error, "Parâmetro inválido.");
    }
  );
});

test("outro erro do banco, de programação ou de sistema → 500 genérico", async () => {
  const cases = [
    () => pgError("23505", 'duplicate key value violates unique constraint "tb_user_email_key"'),
    () => pgError("42P01", 'relation "tb_x" does not exist'),
    () => new TypeError("Cannot read properties of undefined (reading 'id_user')"),
    () => Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { syscall: "connect", errno: -111 }),
  ];
  for (const make of cases) {
    await withApp(make, async (base) => {
      const r = await fetch(`${base}/boom`);
      assert.strictEqual(r.status, 500);
      const body = await r.json();
      assert.strictEqual(body.error, "Erro interno no servidor.");
    });
  }
});

test("mensagem de service para o usuário e status explícito seguem iguais", async () => {
  await withApp(
    () => new Error("Email já cadastrado"),
    async (base) => {
      const r = await fetch(`${base}/boom`);
      assert.strictEqual(r.status, 500);
      assert.strictEqual((await r.json()).error, "Email já cadastrado");
    }
  );
  await withApp(
    () => Object.assign(new Error("Sem permissão"), { statusCode: 403 }),
    async (base) => {
      const r = await fetch(`${base}/boom`);
      assert.strictEqual(r.status, 403);
      assert.strictEqual((await r.json()).error, "Sem permissão");
    }
  );
});

test("rota inexistente responde JSON, não página HTML", async () => {
  await withApp(
    () => new Error("x"),
    async (base) => {
      const r = await fetch(`${base}/nao-existe`);
      assert.strictEqual(r.status, 404);
      assert.match(r.headers.get("content-type") || "", /application\/json/);
      assert.strictEqual((await r.json()).error, "Rota não encontrada.");
    }
  );
});

test("ALLOW_INSECURE_WEBHOOK não vale em produção", async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevAllow = process.env.ALLOW_INSECURE_WEBHOOK;
  const { validateWebhookUrl } = require("../../src/utils/webhookUrl");
  try {
    process.env.ALLOW_INSECURE_WEBHOOK = "1";
    process.env.NODE_ENV = "development";
    assert.deepStrictEqual(await validateWebhookUrl("http://127.0.0.1:5432/x"), { ok: true });
    process.env.NODE_ENV = "production";
    const r = await validateWebhookUrl("http://127.0.0.1:5432/x");
    assert.ok(r.error, "em produção http/IP interno é recusado");
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevAllow === undefined) delete process.env.ALLOW_INSECURE_WEBHOOK;
    else process.env.ALLOW_INSECURE_WEBHOOK = prevAllow;
  }
});
