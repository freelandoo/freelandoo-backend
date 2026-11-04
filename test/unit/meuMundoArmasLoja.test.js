"use strict";
// mm3d-66: Loja de Armas do Arsenal — espadas só de guerreiro, dentro do teto e
// abaixo do degrau que a forja já entrega no mesmo nível.
const test = require("node:test");
const assert = require("node:assert");
const Gear = require("../../src/utils/meuMundoGear");
const { clanOfBody, usesSword, usesHammer } = require("../../src/utils/meuMundoClans");
const { CENTER_INTERIORS } = require("../../src/utils/meuMundoCenterInteriors");

const swords = Gear.GEAR.filter((g) => g.shop === "weapons");

test("16 espadas à venda, todas com preço, descrição e prefixo espada_", () => {
  assert.equal(swords.length, 16);
  for (const s of swords) {
    assert.ok(s.id.startsWith("espada_"), s.id);
    assert.ok(s.price > 0, s.id);
    assert.ok(Gear.itemDetails(s).description, s.id);
    assert.deepEqual(Gear.slotsFor(s), ["weapon"]);
  }
});

test("quem não é guerreiro não equipa espada; guerreiro equipa", () => {
  for (const s of swords) {
    assert.equal(Gear.canEquip(s, { clan: "raposa", level: 60, owned: true }), "clan", s.id);
    assert.equal(Gear.canEquip(s, { clan: "vampiro", level: 60, owned: true }), null, s.id);
  }
});

test("guerreiros: vampiros, Aurion, Morkhan e Zéphyra; essas skins lutam com o kit de espada", () => {
  for (const b of ["vampiro", "vampira", "vampiro_adulto", "vampira_adulta", "aurion", "morkhan", "zephyra"]) {
    assert.ok(usesSword(b), b);
    assert.equal(clanOfBody(b), "vampiro", b);
  }
  for (const b of ["raposa", "raposa_f", "raposa_adulto", "raposa_adulta", "iris", "kragor", "ciborgue", "sergio", "brutamontes"]) assert.ok(!usesSword(b), b);
  assert.equal(clanOfBody("raposa_f"), "raposa");
  assert.equal(clanOfBody("iris"), null); // a skin não decide: segue o kit da conta
});

test("preço e nível sobem juntos; bônus respeita o teto", () => {
  for (let i = 1; i < swords.length; i++) {
    assert.ok(swords[i].price > swords[i - 1].price, swords[i].id);
    assert.ok(swords[i].level >= swords[i - 1].level, swords[i].id);
  }
  for (const s of swords) {
    const b = Gear.gearBonus({ weapon: { id: s.id, level: 10 } });
    for (const [k, v] of Object.entries(b)) assert.ok(v <= Gear.GEAR_CAP[k], `${s.id} ${k}`);
  }
});

test("as espadas da loja podem ser refinadas como as outras armas", () => {
  for (const s of swords) assert.ok(Gear.upgradeCost(s, 0), s.id);
});

test("aba Hammers: 18 armas, preço crescente, sem classe e dentro do teto", () => {
  const heavy = Gear.GEAR.filter((g) => g.shop === "hammers");
  assert.equal(heavy.length, 18);
  heavy.forEach((h, i) => {
    assert.ok(h.id.startsWith("pesada_") && h.clan === null, h.id);
    assert.ok(Gear.itemDetails(h).description, h.id);
    if (i) assert.ok(h.price > heavy[i - 1].price && h.level >= heavy[i - 1].level, h.id);
    const b = Gear.gearBonus({ weapon: { id: h.id, level: 10 } });
    for (const [k, v] of Object.entries(b)) assert.ok(v <= Gear.GEAR_CAP[k], `${h.id} ${k}`);
  });
});

test("Soldado de Pedra, Marú e Kragor usam arma pesada, e nem espada nem kit de maga", () => {
  for (const b of ["golem", "maru", "kragor", "brutamontes"]) {
    assert.ok(usesHammer(b), b);
    assert.ok(!usesSword(b), b);
  }
  for (const b of ["vampiro", "raposa", "aurion", "iris", "ciborgue"]) assert.ok(!usesHammer(b), b);
});

test("Arsenal tem dois balcões e dois vendedores", () => {
  const a = CENTER_INTERIORS.arsenal;
  const uses = a.spots.map((s) => s.use);
  assert.ok(uses.includes("weapons") && uses.includes("armory"), uses.join());
  assert.deepEqual(a.npcs.map((n) => n.role).sort(), ["armeira", "armeiro"]);
});
