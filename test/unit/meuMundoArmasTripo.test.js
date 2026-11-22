"use strict";
// Armas novas do Tripo (22/11/2026): escala de cajados da Raposa (aba Cajados), espadas, pesadas e as
// primeiras Divinas. Catálogo gerado de MEU MUNDO 3D/arte/armas-novas/armas.json.
const test = require("node:test");
const assert = require("node:assert");
const Gear = require("../../src/utils/meuMundoGear");
const { RANK_ORDER } = require("../../src/utils/mmItems/rules/rank");
const { PRICE } = require("../../src/utils/mmItems/rules/classStats");
const TRIPO = require("../../src/utils/mmItems/catalog/weaponsTripo").ITEMS.map((g) => Gear.GEAR_BY_ID.get(g.id));
const PREFIX = { staffs: "cajado_", weapons: "espada_", hammers: "pesada_", bows: "arco_", guns: "fogo_", shields: "escudo_" };

test("todas entram no catálogo com descrição, preço da classe e prefixo da aba", () => {
  assert.equal(TRIPO.length, 74);
  for (const g of TRIPO) {
    assert.ok(g, "item sumiu do catálogo");
    assert.ok(g.id.startsWith(PREFIX[g.shop]), g.id);
    assert.ok(Gear.itemDetails(g).description, g.id);
    assert.equal(g.price, PRICE[g.rank], g.id);
    assert.ok(g.keys && g.keys.length === 2, g.id);
  }
});

test("cajados: escala completa da Raposa, 4 por nível de 1 a 10, mais Lendária e Divina", () => {
  const staffs = TRIPO.filter((g) => g.shop === "staffs");
  assert.equal(staffs.length, 47);
  for (let lv = 1; lv <= 10; lv++) assert.ok(staffs.filter((g) => g.level === lv && !["legendary", "divine"].includes(g.rank)).length === 4, `nível ${lv}`);
  assert.equal(staffs.filter((g) => g.rank === "legendary").length, 5);
  assert.equal(staffs.filter((g) => g.rank === "divine").length, 2);
  for (const g of staffs) {
    assert.equal(g.clan, "raposa", g.id);
    assert.equal(g.stats.kind, "staff", g.id);
    assert.equal(Gear.canEquip(g, { clan: "vampiro", level: 99, owned: true }), "clan", g.id);
    assert.equal(Gear.canEquip(g, { clan: "raposa", level: 99, owned: true }), null, g.id);
  }
});

test("Divina tem itens (rank explícito) e fica acima da Lendária", () => {
  const div = TRIPO.filter((g) => g.rank === "divine");
  assert.deepEqual(div.map((g) => g.id).sort(), ["arco_oito_estrelas", "cajado_aurora_viva", "cajado_cosmos", "escudo_ceu", "escudo_pira", "espada_ceu", "espada_pira", "fogo_celeste", "fogo_cometa", "pesada_eclipse", "pesada_panteao"]);
  for (const g of div) {
    assert.equal(g.rarity, "mythic", g.id);
    assert.ok(g.stats.number > Gear.GEAR_BY_ID.get("cajado_farao").stats.number || g.category === "shield", g.id);
    assert.ok(RANK_ORDER[g.rank] > RANK_ORDER.legendary, g.id);
  }
});

test("bônus das novas respeita o teto, mesmo no +10", () => {
  for (const g of TRIPO) {
    const slot = g.category === "shield" ? "offhand" : "weapon";
    const b = Gear.gearBonus({ [slot]: { id: g.id, level: 10 } });
    for (const [k, v] of Object.entries(b)) assert.ok(v <= Gear.GEAR_CAP[k], `${g.id} ${k}`);
  }
});
