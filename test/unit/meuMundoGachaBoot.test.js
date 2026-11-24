// gacha-v1: o controller e as rotas do Meu Mundo carregam (um nome repetido derruba o boot inteiro).
const test = require("node:test");
const assert = require("node:assert");

test("controller e rotas do Meu Mundo carregam com as Convocações e os convites", () => {
  const C = require("../../src/controllers/MeuMundoController");
  for (const fn of ["gachaGet", "gachaPull", "gachaRecover", "gachaHistory", "characterCapsuleUse", "inviteClaim", "inviteGet", "inviteReward", "invite"]) {
    assert.strictEqual(typeof C[fn], "function", fn);
  }
  assert.ok(require("../../src/routes/meuMundoAdmin.routes.js"));
});
