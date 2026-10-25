// Vestuário (mm3d-16, mig 300): condição física ≠ skin. O padrão desenha a
// condição; uma skin vestida desenha o corpo dela; o cliente espelha os ids.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Skins = require("../../src/utils/meuMundoSkins");
const MeuMundoStorage = require("../../src/storages/MeuMundoStorage");

test("padrão desenha a condição física; skin desenha o próprio corpo", () => {
  for (const c of ["normal", "slim", "fat", "strong"]) {
    assert.equal(Skins.avatarBody(c, "standard"), c);
    assert.equal(Skins.avatarBody(c, "sergio"), "sergio");
    assert.equal(Skins.avatarBody(c, "feminina"), "female");
    assert.equal(Skins.avatarBody(c, "ekaterina"), "ekaterina");
    // skin desconhecida (catálogo mudou) volta para a condição
    assert.equal(Skins.avatarBody(c, "nao-existe"), c);
  }
  assert.equal(Skins.avatarBody(null, null), "normal");
});

test("catálogo: um padrão grátis, skins com preço (a feminina é grátis) e corpo conhecido pela sala", () => {
  const std = Skins.CATALOG.filter((s) => s.kind === "standard");
  assert.equal(std.length, 1);
  assert.equal(std[0].price, 0);
  for (const s of Skins.CATALOG.filter((x) => x.kind === "skin")) {
    assert.ok(s.id === "feminina" ? s.price === 0 : s.price > 0, s.id);
    assert.ok(MeuMundoStorage.BODIES.includes(s.body), s.id);
    assert.match(s.id, /^[a-z0-9-]{1,32}$/);
  }
});

test("publicCatalog: padrão sempre seu; vestido desconhecido = padrão", () => {
  const a = Skins.publicCatalog([], "standard");
  assert.deepEqual(a.map((s) => [s.id, s.owned, s.equipped]), [["standard", true, true], ["sergio", false, false], ["feminina", false, false], ["ekaterina", false, false]]);
  const b = Skins.publicCatalog(["sergio"], "sergio");
  assert.deepEqual(b.map((s) => [s.id, s.owned, s.equipped]), [["standard", true, false], ["sergio", true, true], ["feminina", false, false], ["ekaterina", false, false]]);
  const c = Skins.publicCatalog([], "sumiu");
  assert.equal(c.find((s) => s.id === "standard").equipped, true);
});

test("administrador adquire de graça; os outros pagam o preço", () => {
  const sergio = Skins.skinById("sergio");
  assert.equal(Skins.costFor(sergio, true), 0);
  assert.equal(Skins.costFor(sergio, false), sergio.price);
  assert.equal(Skins.publicCatalog([], "standard", true).find((s) => s.id === "sergio").cost, 0);
  assert.equal(Skins.publicCatalog([], "standard", false).find((s) => s.id === "sergio").cost, sergio.price);
});

test("espelho do cliente: features/meu-mundo/skins.ts tem os mesmos ids", () => {
  const f = path.join(__dirname, "../../../freelandoo frontend/freelandoo-website-main/features/meu-mundo/skins.ts");
  if (!fs.existsSync(f)) return; // CI sem o front ao lado
  const src = fs.readFileSync(f, "utf8");
  for (const s of Skins.CATALOG) assert.match(src, new RegExp(`id: "${s.id}"`), s.id);
});
