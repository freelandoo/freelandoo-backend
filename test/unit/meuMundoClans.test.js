// Classes (mm3d-58): corpo da classe por sexo e fase da vida, e quem passa por
// cima de quem. B3 (mig 340): a skin virou ESPÉCIE do personagem — espécie > classe > condição.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../src/utils/meuMundoClans");
const { characterBody } = require("../../src/utils/meuMundoSpecies");
const MeuMundoStorage = require("../../src/storages/MeuMundoStorage");

test("corpo da classe: classe × sexo × fase", () => {
  assert.equal(C.clanBody("raposa", "m", "young"), "raposa");
  assert.equal(C.clanBody("raposa", "f", "young"), "raposa_f");
  assert.equal(C.clanBody("raposa", "m", "adult"), "raposa_adulto");
  assert.equal(C.clanBody("raposa", "f", "adult"), "raposa_adulta");
  assert.equal(C.clanBody("vampiro", "m", null), "vampiro");
  assert.equal(C.clanBody("vampiro", "f", "adult"), "vampira_adulta");
  assert.equal(C.clanBody(null, "m", "adult"), null);
  assert.equal(C.clanBody("lobo", "m", "adult"), null);
});

test("todo corpo de classe é aceito pela sala", () => {
  assert.equal(C.CLAN_BODIES.length, 8);
  for (const b of C.CLAN_BODIES) assert.ok(MeuMundoStorage.BODIES.includes(b), b);
});

test("prioridade (B3): espécie do personagem > classe > condição física", () => {
  assert.equal(characterBody({ species: null, clan: "vampiro", clanSex: "f", stage: "young", condition: "fat" }), "vampira");
  assert.equal(characterBody({ species: "sergio", clan: "raposa", condition: "fat" }), "sergio");
  assert.equal(characterBody({ species: "aurion", clan: "raposa", condition: "fat" }), "aurion");
  assert.equal(characterBody({ species: null, clan: null, condition: "fat" }), "fat");
  // as classes viraram espécies: o corpo segue sexo e fase
  assert.equal(characterBody({ species: "vampiro", sex: "f", stage: "adult" }), "vampira_adulta");
  assert.equal(characterBody({ species: "raposa", sex: "m", stage: "adult" }), "raposa_adulto");
  for (const b of C.CLAN_BODIES) assert.ok(MeuMundoStorage.BODIES.includes(b), b);
});
