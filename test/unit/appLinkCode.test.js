// test/unit/appLinkCode.test.js
//
// A regra do código de vínculo do app (mig 278). Unit porque é pura: o código
// é digitado à mão no celular, então o que mais importa é o formato e a
// normalização — "abcd efgh" e "ABCD-EFGH" têm de ser o mesmo código, e um
// caractere ambíguo (0/O, 1/I/L) nunca pode ter saído do gerador.
const test = require("node:test");
const assert = require("node:assert");

const C = require("../../src/utils/appLinkCode");

test("o alfabeto não tem ambíguos", () => {
  for (const ch of "0O1IL") assert.ok(!C.ALPHABET.includes(ch), ch);
});

test("o gerador só usa o alfabeto e tem 8 caracteres", () => {
  for (let i = 0; i < 500; i += 1) {
    const code = C.generateCode();
    assert.strictEqual(code.length, C.CODE_LENGTH);
    for (const ch of code) assert.ok(C.ALPHABET.includes(ch));
  }
});

test("normalizar ignora caixa, espaço e hífen", () => {
  const code = C.generateCode();
  const shown = C.formatCode(code);
  assert.match(shown, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.strictEqual(C.normalizeCode(shown), code);
  assert.strictEqual(C.normalizeCode(shown.toLowerCase().replace("-", " ")), code);
});

test("normalizar recusa o que não pode ser código", () => {
  assert.strictEqual(C.normalizeCode(null), null);
  assert.strictEqual(C.normalizeCode("ABC"), null);
  assert.strictEqual(C.normalizeCode("ABCD-EFG0"), null);
  assert.strictEqual(C.normalizeCode("ABCDEFGHJ"), null);
});

test("o hash é o mesmo para o código formatado e o cru", () => {
  const code = C.generateCode();
  assert.strictEqual(C.sha256(C.normalizeCode(C.formatCode(code))), C.sha256(code));
  assert.match(C.sha256(code), /^[0-9a-f]{64}$/);
});

test("o refresh token tem a forma que a porta aceita", () => {
  const t = C.generateSessionToken();
  assert.ok(C.isSessionTokenShape(t), t);
  assert.ok(!C.isSessionTokenShape("evo_rt_curto"));
  assert.ok(!C.isSessionTokenShape(t.replace("evo_rt_", "outro_")));
});
