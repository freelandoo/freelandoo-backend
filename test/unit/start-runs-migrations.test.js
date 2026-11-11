// Guarda (2026-11-11): o boot de produção precisa rodar as migrations.
// Com ignore-scripts=true no .npmrc (segurança 0B) o npm pula `prestart` em silêncio;
// foi assim que as migs 436–444 ficaram sem rodar e o fim de luta quebrou em produção.
const test = require("node:test");
const assert = require("node:assert");
const pkg = require("../../package.json");

test("npm start roda as migrations antes do servidor (sem depender de prestart)", () => {
  assert.match(pkg.scripts.start, /^node run-migrations.js && node index.js$/);
  assert.strictEqual(pkg.scripts.prestart, undefined);
});
