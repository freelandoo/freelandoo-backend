// Bloqueio progressivo de login por conta (A3).
const test = require("node:test");
const assert = require("node:assert");
const t = require("../../src/utils/loginThrottle");

test("5 erros travam 1 min; depois dobra; teto 30 min; acerto limpa", () => {
  t._reset();
  const now = 1_000_000;
  for (let i = 0; i < 4; i++) t.fail("A@x.test", now);
  assert.strictEqual(t.check("a@x.test", now).locked, false);
  t.fail("a@x.test", now);
  const c = t.check("a@x.test", now + 1000);
  assert.strictEqual(c.locked, true);
  assert.strictEqual(c.retryAfterSeconds, 59);
  assert.strictEqual(t.check("a@x.test", now + 61_000).locked, false);
  t.fail("a@x.test", now + 61_000);
  assert.strictEqual(t.check("a@x.test", now + 61_000 + 119_000).locked, true);
  for (let i = 0; i < 20; i++) t.fail("a@x.test", now + 200_000);
  assert.ok(t.check("a@x.test", now + 200_000).retryAfterSeconds <= 30 * 60);
  t.clear("a@x.test");
  assert.strictEqual(t.check("a@x.test", now + 200_000).locked, false);
});

test("janela de 15 min esquece erros velhos", () => {
  t._reset();
  for (let i = 0; i < 4; i++) t.fail("b@x.test", 0);
  t.fail("b@x.test", 16 * 60 * 1000);
  assert.strictEqual(t.check("b@x.test", 16 * 60 * 1000).locked, false);
});

test("mensagem diz os minutos", () => {
  assert.match(t.lockedMessage(59), /1 minuto /);
  assert.match(t.lockedMessage(600), /10 minutos/);
});
