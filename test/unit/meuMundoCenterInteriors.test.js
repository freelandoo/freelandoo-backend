// Interiores do centro (mm3d-37): toda planta monta, e cada prédio tem o que
// o pedido exige — treinar na academia, estudar na universidade/biblioteca/
// escola, rezar na igreja, pedir na pizzaria/hamburgueria, pagar no caixa,
// falar com o vendedor sentado e as celas da delegacia.
const test = require("node:test");
const assert = require("node:assert/strict");
const { CENTER_INTERIORS: I, JAIL_BEDS } = require("../../src/utils/meuMundoCenterInteriors");
const { isFreeSpot } = require("../../src/utils/meuMundoInteriorMotion");

const uses = (d) => [...d.seats.map((s) => s.use), ...d.spots.map((s) => s.use)].filter(Boolean);
const count = (d, u) => uses(d).filter((x) => x === u).length;

test("os treze prédios montam sem problema, com entrada livre e saída pela porta", () => {
  assert.deepEqual(Object.keys(I).sort(), ["academia", "arsenal", "biblioteca", "criolab", "delegacia", "escola", "forja", "hall", "hamburgueria", "igreja", "pizzaria", "supermercado", "universidade"]);
  for (const [id, d] of Object.entries(I)) {
    assert.deepEqual(d.problems, [], id);
    assert.ok(isFreeSpot(d, 0, d.entry.x, d.entry.z), `${id}: entrada livre`);
    assert.ok(d.exit.radius > 0, id);
    assert.ok(d.theme === id, `${id}: tema`);
  }
});

test("cada prédio tem o seu uso", () => {
  assert.ok(count(I.academia, "train") >= 10, "aparelhos de treino");
  for (const id of ["universidade", "biblioteca", "escola"]) assert.ok(count(I[id], "study") >= 9, `${id}: lugares de estudo`);
  assert.ok(count(I.igreja, "pray") >= 60, "bancos da igreja");
  assert.equal(count(I.pizzaria, "order"), 1);
  assert.equal(count(I.hamburgueria, "order"), 1);
  assert.equal(count(I.supermercado, "market"), 2, "dois caixas");
  assert.equal(count(I.supermercado, "seller"), 1, "a cadeira em frente ao vendedor");
  assert.equal(count(I.delegacia, "police"), 1, "o balcão da delegacia");
  assert.equal(count(I.forja, "forge"), 1, "a bigorna abre a forja");
  assert.equal(count(I.forja, "refine"), 1, "a bancada abre o refinamento");
  assert.equal(count(I.arsenal, "armory"), 1, "o balcão abre o arsenal");
});

test("oficinas: cada bancada é alcançável da entrada sem atravessar móveis ou NPCs", () => {
  const cell = 0.2;
  for (const id of ["forja", "arsenal"]) {
    const d = I[id];
    const key = (x, z) => `${Math.round(x / cell)},${Math.round(z / cell)}`;
    const q = [[d.entry.x, d.entry.z + 1.6]];
    const seen = new Set([key(...q[0])]);
    while (q.length) {
      const [x, z] = q.pop();
      for (const [dx, dz] of [[cell, 0], [-cell, 0], [0, cell], [0, -cell]]) {
        const nx = Math.round((x + dx) * 1000) / 1000;
        const nz = Math.round((z + dz) * 1000) / 1000;
        const k = key(nx, nz);
        if (seen.has(k) || !isFreeSpot(d, 0, nx, nz)) continue;
        seen.add(k);
        q.push([nx, nz]);
      }
    }
    for (const spot of d.spots) assert.ok(seen.has(key(spot.x, spot.z)), `${id}: ${spot.use} alcançável`);
  }
});

test("o vendedor fica sentado e a cadeira dele não é oferecida a ninguém", () => {
  const sm = I.supermercado;
  const v = sm.npcs.find((n) => n.role === "vendedor");
  assert.ok(v && v.pose === "sit");
  assert.ok(!sm.seats.some((s) => Math.hypot(s.x - v.x, s.z - v.z) < 0.1), "assento do vendedor fora da lista");
  // O cliente senta de frente para ele, do outro lado da mesa.
  const c = sm.seats.find((s) => s.use === "seller");
  assert.ok(Math.abs(c.z - v.z) < 0.01 && c.x > v.x, "de frente");
});

test("celas: duas camas que não se alcançam da porta (a grade fecha)", () => {
  assert.equal(JAIL_BEDS.length, 2);
  const d = I.delegacia;
  for (const b of d.beds) assert.ok(b.z > 10, "a cama fica dentro da cela");
});

test("pontos de uso e assentos ficam livres e dentro do prédio", () => {
  for (const [id, d] of Object.entries(I)) {
    const b = d.bounds;
    for (const s of [...d.spots, ...d.seats.map((x) => x.stand)]) {
      assert.ok(s.x > b.minX && s.x < b.maxX && s.z > b.minZ && s.z < b.maxZ, `${id}: dentro`);
      assert.ok(isFreeSpot(d, 0, s.x, s.z), `${id}: livre em ${s.x},${s.z}`);
    }
  }
});

test("cardápios dos restaurantes: itens do catálogo, comida e bebida (mm3d-37c)", () => {
  const L = require("../../src/utils/meuMundoLife");
  for (const [place, menu] of Object.entries(L.MENUS)) {
    assert.ok(I[place], `${place} tem interior`);
    assert.ok(menu.length >= 3, place);
    for (const id of menu) {
      const it = L.ITEM_BY_ID.get(id);
      assert.ok(it && (it.kind === "food" || it.kind === "drink") && it.currency === "coins", `${place}: ${id}`);
    }
  }
  assert.ok(I[L.MARKET_PLACE], "o supermercado tem interior");
});

test("Salão do Hall da Fama (mm3d-48): os Sete nos pedestais, a base do Oitavo e o Muro", () => {
  const h = I.hall;
  const heroes = h.floors[0].furniture.filter((f) => f.t === "hero_statue").map((f) => f.hero);
  assert.deepEqual(heroes.sort(), ["aeryn", "aurion", "iris", "kragor", "maru", "noctis", "zephyra"]);
  assert.equal(h.floors[0].furniture.filter((f) => f.t === "empty_base").length, 1);
  assert.equal(h.floors[0].furniture.filter((f) => f.t === "honor_wall").length, 1);
  // Do tapete dá para chegar ao pé de Aurion.
  assert.ok(isFreeSpot(h, 0, 0, 16.4), "frente de Aurion livre");
});
