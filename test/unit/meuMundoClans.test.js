// Classes (mm3d-58): corpo da classe por sexo e fase da vida, e quem passa por
// cima de quem (skin comprada > classe > padrão/feminina/condição).
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../src/utils/meuMundoClans");
const { avatarBody } = require("../../src/utils/meuMundoSkins");
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

test("prioridade: skin comprada > classe > padrão/feminina/condição", () => {
  assert.equal(avatarBody("fat", "standard", "vampira"), "vampira");
  assert.equal(avatarBody("fat", "feminina", "raposa"), "raposa");
  assert.equal(avatarBody("fat", "sergio", "raposa"), "sergio");
  assert.equal(avatarBody("fat", "aurion", "raposa"), "aurion");
  assert.equal(avatarBody("fat", "standard", null), "fat");
  assert.equal(avatarBody("fat", "feminina", null), "female");
});

test("skins de teste das classes: só admin vê, já vêm suas, passam por cima da classe", () => {
  const Skins = require("../../src/utils/meuMundoSkins");
  assert.equal(Skins.CLAN_SKINS.length, 8);
  for (const [id, body] of Skins.CLAN_SKINS) {
    assert.match(id, /^[a-z0-9-]{1,32}$/, id); // CHECK chk_mm_avatar_skin (mig 300)
    assert.equal(Skins.skinById(id).body, body);
    assert.equal(avatarBody("normal", id, "raposa"), body);
  }
  const ids = (admin) => Skins.publicCatalog([], "standard", admin).map((s) => s.id);
  assert.ok(!ids(false).includes("vampira-adulta"));
  const mine = Skins.publicCatalog([], "standard", true).find((s) => s.id === "vampira-adulta");
  assert.equal(mine.owned, true);
  assert.equal(mine.cost, 0);
});
