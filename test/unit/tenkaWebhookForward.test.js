// test/unit/tenkaWebhookForward.test.js
//
// Repasse dos avisos da loja da TENKA (mesma conta MP). O que estes testes
// seguram: (1) só recurso `tenka:` sai daqui; (2) falha de leitura nunca tira
// um evento da Freelandoo do caminho dela; (3) o repasse leva a assinatura
// ORIGINAL do Mercado Pago; (4) sem TENKA_WEBHOOK_URL, nada roda.
const test = require("node:test");
const assert = require("node:assert");

const forwardSvc = require("../../src/services/TenkaWebhookForwardService");

function client({ payment, preapproval, authorized, fail } = {}) {
  return {
    async getPayment() {
      if (fail) throw new Error("rede");
      return payment;
    },
    async getPreapproval() {
      if (fail) throw new Error("rede");
      return preapproval;
    },
    async getAuthorizedPayment() {
      if (fail) throw new Error("rede");
      return authorized;
    },
  };
}

test("reconhece o prefixo da TENKA e nada mais", () => {
  assert.strictEqual(forwardSvc.isTenkaRef("tenka:6f1c3a52-7d1e-4f3b-9a3e-2b8c1d0e9f10:subscription"), true);
  assert.strictEqual(forwardSvc.isTenkaRef("6f1c3a52-7d1e-4f3b-9a3e-2b8c1d0e9f10"), false);
  assert.strictEqual(forwardSvc.isTenkaRef(null), false);
});

test("assinatura com referência tenka: é da TENKA", async () => {
  const c = client({ preapproval: { id: "pre1", external_reference: "tenka:x:subscription" } });
  assert.strictEqual(await forwardSvc.belongsToTenka({ type: "subscription_preapproval", data: { id: "pre1" } }, c), true);
});

test("fatura de assinatura resolve pelo preapproval", async () => {
  const c = client({
    authorized: { id: "ap1", preapproval_id: "pre1" },
    preapproval: { id: "pre1", external_reference: "tenka:x:subscription" },
  });
  assert.strictEqual(await forwardSvc.belongsToTenka({ type: "subscription_authorized_payment", data: { id: "ap1" } }, c), true);
});

test("evento da Freelandoo não é repassado", async () => {
  const c = client({ payment: { id: 1, external_reference: "6f1c3a52-7d1e-4f3b-9a3e-2b8c1d0e9f10" } });
  assert.strictEqual(await forwardSvc.belongsToTenka({ type: "payment", data: { id: "1" } }, c), false);
});

test("falha ao consultar o MP mantém o evento na Freelandoo", async () => {
  const c = client({ fail: true });
  assert.strictEqual(await forwardSvc.belongsToTenka({ type: "subscription_preapproval", data: { id: "pre1" } }, c), false);
});

test("sem TENKA_WEBHOOK_URL (ou sem https), desligado", () => {
  delete process.env.TENKA_WEBHOOK_URL;
  assert.strictEqual(forwardSvc.isEnabled(), false);
  process.env.TENKA_WEBHOOK_URL = "http://inseguro.example.com/webhooks/mercadopago";
  assert.strictEqual(forwardSvc.isEnabled(), false);
  delete process.env.TENKA_WEBHOOK_URL;
});

test("repasse leva querystring, x-signature e x-request-id originais", async () => {
  process.env.TENKA_WEBHOOK_URL = "https://tenka.example.com/webhooks/mercadopago";
  let seen = null;
  const fakeFetch = async (url, init) => {
    seen = { url, init };
    return { status: 200 };
  };
  const ok = await forwardSvc.forward(
    {
      query: { "data.id": "pre1", type: "subscription_preapproval" },
      headers: { "x-signature": "ts=1,v1=abc", "x-request-id": "req-9", cookie: "nao-vai" },
      body: { id: 123, type: "subscription_preapproval", data: { id: "pre1" } },
    },
    fakeFetch
  );
  assert.strictEqual(ok, true);
  const u = new URL(seen.url);
  assert.strictEqual(u.searchParams.get("data.id"), "pre1");
  assert.strictEqual(seen.init.headers["x-signature"], "ts=1,v1=abc");
  assert.strictEqual(seen.init.headers["x-request-id"], "req-9");
  assert.strictEqual(seen.init.headers["x-tenka-forwarded-by"], "freelandoo");
  assert.strictEqual(seen.init.headers.cookie, undefined);
  assert.deepStrictEqual(JSON.parse(seen.init.body), { id: 123, type: "subscription_preapproval", data: { id: "pre1" } });
  delete process.env.TENKA_WEBHOOK_URL;
});

test("TENKA fora do ar → false (o controller devolve 500 e o MP re-entrega)", async () => {
  process.env.TENKA_WEBHOOK_URL = "https://tenka.example.com/webhooks/mercadopago";
  assert.strictEqual(await forwardSvc.forward({ query: {}, headers: {}, body: {} }, async () => ({ status: 503 })), false);
  assert.strictEqual(
    await forwardSvc.forward({ query: {}, headers: {}, body: {} }, async () => {
      throw new Error("ECONNREFUSED");
    }),
    false
  );
  delete process.env.TENKA_WEBHOOK_URL;
});
