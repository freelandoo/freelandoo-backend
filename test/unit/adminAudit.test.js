// Trilha das ações de admin (Segurança A1 lote 7): o corpo gravado nunca leva segredo.
const test = require("node:test");
const assert = require("node:assert");
const { redact } = require("../../src/utils/adminAudit");

test("chave com cara de segredo vira [oculto], em qualquer nível", () => {
  const out = redact({
    api_key: "sk-123",
    senha: "x",
    nested: { webhook_secret: "s", pix_key: "p", cpf: "12345678909", ok: 1 },
    list: [{ access_token: "t", nome: "Ana" }],
  });
  assert.deepStrictEqual(out, {
    api_key: "[oculto]",
    senha: "[oculto]",
    nested: { webhook_secret: "[oculto]", pix_key: "[oculto]", cpf: "[oculto]", ok: 1 },
    list: [{ access_token: "[oculto]", nome: "Ana" }],
  });
});

test("texto, lista e profundidade têm teto", () => {
  const long = "a".repeat(500);
  assert.strictEqual(redact(long).length, 201);
  const arr = redact(Array.from({ length: 30 }, (_, i) => i));
  assert.strictEqual(arr.length, 21);
  assert.strictEqual(arr[20], "[+10]");
  assert.deepStrictEqual(redact({ a: { b: { c: { d: { e: 1 } } } } }), { a: { b: { c: { d: "[…]" } } } });
  assert.strictEqual(redact(Buffer.from("abc")), "[3 bytes]");
});

test("valores comuns passam como estão", () => {
  assert.deepStrictEqual(redact({ is_admin: true, id_user: "u1", priority: 2, x: null }), {
    is_admin: true,
    id_user: "u1",
    priority: 2,
    x: null,
  });
});
