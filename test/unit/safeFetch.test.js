// Segurança A4 (SSRF): o `fetch` das URLs que vêm de usuário (webhook de saída, reencaminhamento de
// WhatsApp da academia, API da academia) valida de novo em cada envio e não segue redirecionamento.
const test = require("node:test");
const assert = require("node:assert");

delete process.env.ALLOW_INSECURE_WEBHOOK;
const { safeFetch, UnsafeUrlError } = require("../../src/utils/safeFetch");

function withFetch(fake, fn) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return fake(url, opts);
  };
  return fn(calls).finally(() => {
    global.fetch = real;
  });
}

test("recusa IP privado, loopback e metadados da nuvem sem nem chamar o fetch", async () => {
  await withFetch(
    () => ({ status: 200 }),
    async (calls) => {
      for (const u of ["https://127.0.0.1/x", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/", "https://192.168.1.1/", "https://[::1]/"]) {
        await assert.rejects(safeFetch(u, { method: "POST" }), UnsafeUrlError, u);
      }
      assert.equal(calls.length, 0);
    }
  );
});

test("recusa http (só https)", async () => {
  await assert.rejects(safeFetch("http://93.184.216.34/hook"), UnsafeUrlError);
});

test("não segue redirecionamento: 3xx vira erro", async () => {
  await withFetch(
    () => ({ status: 302, headers: new Map([["location", "http://169.254.169.254/"]]) }),
    async (calls) => {
      await assert.rejects(safeFetch("https://93.184.216.34/hook", { method: "POST" }), /redirecionamento/);
      assert.equal(calls[0].opts.redirect, "manual");
    }
  );
});

test("endereço público passa e o pedido sai com redirect manual", async () => {
  await withFetch(
    () => ({ status: 200, ok: true }),
    async (calls) => {
      const r = await safeFetch("https://93.184.216.34/hook", { method: "POST", body: "{}" });
      assert.equal(r.status, 200);
      assert.equal(calls[0].opts.redirect, "manual");
      assert.equal(calls[0].opts.method, "POST");
    }
  );
});
