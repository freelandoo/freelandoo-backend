// Lore v2 F6 — prédios por nível do treinador (utils/meuMundoBuildings.js) e o espelho do front.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const B = require("../../src/utils/meuMundoBuildings");
const C = require("../../src/utils/meuMundoCenter");
const Q = require("../../src/utils/meuMundoQuests");

test("todo prédio do centro tem nível na tabela (e nada fora dela)", () => {
  const ids = C.PLACES.map((p) => p.id).sort();
  assert.deepEqual(Object.keys(B.BUILDING_LEVELS).sort(), ids);
});

test("decisão do Alex: 1ª sessão; minijogos um a cada 2 níveis com o Paint por último; Hall e Laboratório completo no 10", () => {
  for (const id of ["criolab", "supermercado", "pizzaria", "hamburgueria", "academia"]) assert.equal(B.minLevelOf(id), 1, id);
  const games = C.PLACES.filter((x) => /^game:/.test(x.destination) && x.id !== "laminas").map((p) => B.minLevelOf(p.id)).sort((a, b) => a - b);
  assert.deepEqual(games, [3, 5, 7, 9, 11, 13]);
  assert.equal(B.minLevelOf("paint"), Math.max(...games));
  assert.equal(B.minLevelOf("laminas"), 10);
  assert.equal(B.featureLevelOf("lab_full"), 10);
  assert.equal(B.featureLevelOf("char_market"), 10);
});

test("ninguém fica preso: casa/comida/Laboratório/hospital/delegacia sempre abertos", () => {
  for (const id of B.ALWAYS_OPEN) assert.ok(B.isOpen(id, 1), id);
  assert.ok(B.isOpen("hospital", 1) && B.isOpen("delegacia", 1));
  assert.ok(!B.isOpen("jetpack", 4) && B.isOpen("jetpack", 5) && B.isOpen("jetpack", 1, true));
});

test("o capítulo de cada nível só pede prédios que abrem dentro da faixa dele", () => {
  const WHERE = { academia: "academia", universidade: "universidade", supermercado: "supermercado", forja: "forja", arsenal: "arsenal", laboratorio: "criolab", delegacia: "delegacia", paint: "paint", jetpack: "jetpack", boxe: "boxe", noturno: "noturno", corrida: "corrida", hall: "laminas", laminas: "laminas" };
  for (const ch of Q.CHAPTERS)
    for (const s of ch.steps) {
      const place = WHERE[s.where];
      // a faixa do capítulo vai até um nível antes do próximo (cap. 5 = 11–13)
      const next = Q.CHAPTER_BY_ID.get(ch.next);
      const top = next ? next.minTrainerLevel - 1 : 30;
      if (place) assert.ok(B.isOpen(place, top), `${ch.id}:${s.key} em ${place} (até o nível ${top})`);
    }
  // cap. 3 (5–7) pede 3 jogos diferentes: no fim da faixa precisa haver 3 abertos
  const open7 = C.PLACES.filter((p) => /^game:/.test(p.destination) && p.id !== "laminas" && B.isOpen(p.id, 7)).length;
  assert.ok(open7 >= 3, `no nível 7 há ${open7} minijogos`);
});

test("missões de prédio: ids pr_*, lugar existe, abre junto com o prédio, check conhecido", () => {
  const known = ["game", "games", "practice", "forge", "visit", "hallChallenge", "ack"];
  for (const q of B.BUILDING_QUESTS) {
    assert.match(q.id, /^pr_[a-z_]+$/);
    assert.ok(C.PLACES.some((p) => p.id === q.place), q.place);
    assert.ok(q.minLevel >= B.minLevelOf(q.place), q.id);
    assert.ok(known.includes(Q.parseCheck(q.check).type), q.check);
    assert.ok(!Q.CHAPTERS.some((c) => c.id === q.id));
  }
});

test("espelho do cliente: buildings.ts tem a mesma tabela", (t) => {
  const file = path.join(__dirname, "../../../freelandoo frontend/freelandoo-website-main/features/meu-mundo/buildings.ts");
  if (!fs.existsSync(file)) return t.skip("frontend não está ao lado");
  const src = fs.readFileSync(file, "utf8");
  for (const [id, lv] of Object.entries(B.BUILDING_LEVELS)) assert.match(src, new RegExp(`\\n  ${id}: ${lv},`), id);
  const front = [...src.matchAll(/\n {2}([a-z_]+): (\d+),/g)].map((m) => m[1]);
  for (const [f, lv] of Object.entries(B.FEATURE_LEVELS)) assert.match(src, new RegExp(`\\n  ${f}: ${lv},`), f);
  assert.equal(front.length, Object.keys(B.BUILDING_LEVELS).length + Object.keys(B.FEATURE_LEVELS).length);
  assert.match(src, new RegExp(`export const ALWAYS_OPEN = \\[${B.ALWAYS_OPEN.map((x) => `"${x}"`).join(", ")}\\]`));
});
