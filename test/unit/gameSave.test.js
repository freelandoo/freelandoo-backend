// test/unit/gameSave.test.js — régua pura dos saves do EVO Brazil (mig 279).
const test = require("node:test");
const assert = require("node:assert");
const { parseSlot, cleanSummary, validateSave, MAX_BYTES } = require("../../src/utils/gameSave");

test("slot só de 1 a 5, inteiro", () => {
  assert.strictEqual(parseSlot("3"), 3);
  for (const s of ["0", "6", "1.5", "abc", "", null, undefined, -1]) assert.strictEqual(parseSlot(s), null);
});

test("resumo guarda só campos conhecidos e valores simples", () => {
  const r = cleanSummary({ nome: "Cat", semana: 2, creditos: 300, lixo: "x", ranking: { a: 1 }, ano: NaN });
  assert.deepStrictEqual(r, { nome: "Cat", semana: 2, creditos: 300 });
  assert.deepStrictEqual(cleanSummary(null), {});
  assert.deepStrictEqual(cleanSummary([1, 2]), {});
});

test("save precisa ser objeto, respeita o teto e tira a versão do próprio save", () => {
  assert.ok(validateSave({}).error);
  assert.ok(validateSave({ data: [1] }).error);
  const ok = validateSave({ data: { versao: 6, bicho: null }, summary: { nome: "A" } });
  assert.strictEqual(ok.game_version, 6);
  assert.deepStrictEqual(ok.summary, { nome: "A" });
  assert.ok(validateSave({ data: { x: "a".repeat(MAX_BYTES) } }).error);
});
