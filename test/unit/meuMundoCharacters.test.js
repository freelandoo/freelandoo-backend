// test/unit/meuMundoCharacters.test.js — MEU MUNDO 3D B3 (2026-11-08): personagens no
// lugar das skins. A regra mora no front (features/meu-mundo/characters/rules.ts) e o back
// roda a cópia GERADA (src/utils/meuMundoCharacters.js, scripts/build-characters-sim.js).
//
// Aqui: a cópia em dia e o ESPELHO front × back; o crescimento (1,00 m → jovem em 30 dias
// de vida ativa → altura final da espécie em mais 30); a cápsula (congelar/descongelar não
// envelhece nem perde atributo, e a morte por velhice conta só a vida ativa); a fusão (20%
// do maior pico, espécie entre as dos pais, semente sem ordem); e a conversão das skins.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const C = require("../../src/utils/meuMundoCharacters");
const L = require("../../src/utils/meuMundoLife");
const { characterBody } = require("../../src/utils/meuMundoSpecies");

process.removeAllListeners("warning");
const gen = require("../../scripts/build-characters-sim");
const FRONT_RULES = path.join(path.dirname(gen.OUT), "..", "..", "..", "freelandoo frontend", "freelandoo-website-main", "features", "meu-mundo", "characters", "rules.ts");
const FRONT = process.env.MM_FRONT ? path.join(process.env.MM_FRONT, "features/meu-mundo/characters/rules.ts") : FRONT_RULES;
const DAY = 86400000;

test("personagens — a cópia do back está em dia com o front", (t) => {
  if (!fs.existsSync(FRONT)) return t.skip("front fora do lugar");
  const cur = fs.readFileSync(gen.OUT, "utf8").replace(/\r\n/g, "\n");
  assert.equal(cur, gen.build().replace(/\r\n/g, "\n"), "rode node scripts/build-characters-sim.js");
});

test("personagens — ESPELHO: o TS do front e o back dão o mesmo resultado", async (t) => {
  if (!fs.existsSync(FRONT)) return t.skip("front fora do lugar");
  const F = await import(pathToFileURL(FRONT).href);
  const t0 = Date.UTC(2026, 10, 8);
  for (const sp of C.SPECIES_IDS) {
    for (const sex of ["m", "f", null]) {
      for (const stage of ["young", "adult", null]) assert.equal(C.speciesBody(sp, sex, stage), F.speciesBody(sp, sex, stage));
      for (const days of [0, 7, 15, 30, 45]) {
        const g = { stage: "young", from: t0 }
        assert.equal(C.speciesHeight(sp, sex, g, t0 + days * DAY), F.speciesHeight(sp, sex, g, t0 + days * DAY));
        const a = { stage: "adult", from: t0, at: t0 + 40 * DAY }
        assert.equal(C.speciesHeight(sp, sex, a, t0 + (40 + days) * DAY), F.speciesHeight(sp, sex, a, t0 + (40 + days) * DAY));
      }
    }
  }
  for (const [a, b] of [[1, 2], [99, 7], [2147483646, 123456]]) {
    assert.equal(C.fusionSeed(a, b), F.fusionSeed(a, b));
    const p = { discipline: 0.2, anxiety: 0.9 };
    assert.deepEqual(C.fusionPersonality(p, null, C.fusionSeed(a, b)), F.fusionPersonality(p, null, F.fusionSeed(a, b)));
    assert.equal(C.fusionTemper("psicopata", "covarde", a), F.fusionTemper("psicopata", "covarde", a));
  }
  assert.deepEqual(C.SKIN_SPECIES, F.SKIN_SPECIES);
});

test("crescer: 1,00 m ao nascer → jovem em 30 dias ativos → altura final em mais 30", () => {
  const t0 = Date.UTC(2026, 10, 8);
  const young = { stage: "young", from: t0 };
  assert.equal(C.speciesHeight("raposa", "m", young, t0), 1.0);
  assert.equal(C.speciesHeight("raposa", "m", young, t0 + 15 * DAY), 1.35);
  assert.equal(C.speciesHeight("raposa", "m", young, t0 + 30 * DAY), 1.7);
  assert.equal(C.speciesHeight("raposa", "f", young, t0 + 90 * DAY), 1.65, "jovem fica na altura de jovem até virar adulto");
  const adult = { stage: "adult", from: t0, at: t0 + 40 * DAY };
  assert.equal(C.speciesHeight("vampiro", "m", adult, t0 + 40 * DAY), 1.7);
  assert.equal(C.speciesHeight("vampiro", "m", adult, t0 + 70 * DAY), 2.4);
  assert.equal(C.speciesHeight("aurion", null, adult, t0 + 200 * DAY), 3.2);
  assert.equal(C.speciesHeight("golem", null, adult, t0 + 200 * DAY), 4.0);
  assert.equal(C.speciesHeight("brutamontes", null, adult, t0 + 200 * DAY), 4.0);
  assert.equal(C.speciesHeight(null, null, adult, t0), 1.8, "sem espécie: a altura dos avatares do bairro");
});

test("corpo: espécie do personagem > classe do jogador > condição física", () => {
  assert.equal(characterBody({ species: "aurion", clan: "raposa", condition: "fat" }), "aurion");
  assert.equal(characterBody({ species: "vampiro", sex: "f", stage: "adult", clan: "raposa" }), "vampira_adulta");
  assert.equal(characterBody({ species: null, clan: "raposa", clanSex: "f", stage: "young" }), "raposa_f");
  assert.equal(characterBody({ species: null, clan: null, condition: "fat" }), "fat");
  assert.equal(characterBody({}), "normal");
  // espécie de sexo fixo manda no sexo
  assert.equal(C.speciesSex("zephyra", "m"), "f");
});

test("cápsula: congelado não envelhece, não perde atributo nem sente fome", () => {
  const t0 = Date.UTC(2026, 10, 8, 12);
  const s = L.birth(7, t0);
  L.simulate(s, t0 + 3 * DAY, { coins: 0 }, {});
  s.strength = 300;
  s.peaks.strength = 300;
  const before = { strength: s.strength, satiety: s.satiety, wear: s.wearDays, from: s.growth?.from };
  const t1 = s.simAt;
  L.freeze(s, t1);
  // 60 dias guardado
  const t2 = t1 + 60 * DAY;
  const shift = L.thaw(s, t2);
  assert.equal(shift, 60 * DAY);
  assert.equal(s.simAt, t2);
  assert.equal(s.strength, before.strength, "não perde atributo na cápsula");
  assert.equal(s.satiety, before.satiety, "não tem fome na cápsula");
  assert.equal(s.wearDays, before.wear, "a idade (vida ativa) não anda na cápsula");
  if (before.from) assert.equal(s.growth.from, before.from + 60 * DAY, "o nascimento anda junto: a idade ativa fica igual");
  assert.equal(C.activeDays(s.growth, t2), C.activeDays({ ...s.growth, from: before.from }, t1));
});

test("cápsula: a morte por velhice conta só a vida ativa", () => {
  const t0 = Date.UTC(2026, 10, 8, 12);
  const s = L.birth(11, t0);
  L.simulate(s, t0 + 2 * DAY, { coins: 0 }, {});
  const wear = s.wearDays;
  L.freeze(s, s.simAt);
  L.thaw(s, s.simAt + 2000 * DAY); // guardado por mais que uma vida inteira
  assert.equal(s.wearDays, wear);
  assert.equal(s.status, "alive");
});

test("fusão: 20% do MAIOR pico dos pais, por atributo", () => {
  const a = { strength: 800, intelligence: 100, dexterity: 0, speed: 333, accuracy: 50 };
  const b = { strength: 200, intelligence: 900, dexterity: 40, speed: 333, accuracy: 0 };
  assert.deepEqual(C.fusionInherit(a, b), { strength: 160, intelligence: 180, dexterity: 8, speed: 66.6, accuracy: 10 });
  assert.deepEqual(C.fusionInherit(null, null), { strength: 0, intelligence: 0, dexterity: 0, speed: 0, accuracy: 0 });
});

test("fusão: espécie entre as dos pais (sem sorteio), semente sem ordem, temperamento de um dos pais", () => {
  assert.deepEqual(C.fusionSpecies("aurion", "raposa"), ["aurion", "raposa"]);
  assert.deepEqual(C.fusionSpecies("raposa", "raposa"), ["raposa"]);
  assert.deepEqual(C.fusionSpecies("lobo", null), []);
  assert.equal(C.fusionSeed(5, 9), C.fusionSeed(9, 5));
  const sd = C.fusionSeed(5, 9);
  assert.ok(sd >= 1 && sd < 2147483647);
  assert.ok(["psicopata", "covarde"].includes(C.fusionTemper("psicopata", "covarde", sd)));
  assert.equal(C.fusionTemper(null, null, sd), null);
  const p = C.fusionPersonality({ discipline: 0 }, { discipline: 1 }, sd);
  assert.ok(p.discipline >= 0.4 && p.discipline <= 0.6, "média dos pais ± 0,1");
});

test("skins → espécies: toda skin vendida vira uma espécie conhecida; a feminina fica de fora", () => {
  for (const [skin, v] of Object.entries(C.SKIN_SPECIES)) {
    assert.ok(C.speciesById(v.species), `${skin} → ${v.species}`);
    assert.ok(v.sex === "m" || v.sex === "f");
  }
  assert.equal(C.SKIN_SPECIES.feminina, undefined);
  assert.equal(C.SKIN_SPECIES["vampira-adulta"].species, "vampiro");
  assert.equal(C.SKIN_SPECIES["vampira-adulta"].sex, "f");
  assert.equal(C.CAPSULE.SLOTS, 5);
  assert.equal(C.serialText(123), "MM-000123");
});

test("mig 340: a tabela skin → espécie do SQL é a mesma de SKIN_SPECIES", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../../src/databases/migrations/340_meu_mundo_personagens.sql"), "utf8");
  const block = sql.slice(sql.indexOf("JOIN (VALUES"), sql.indexOf(") AS m(skin, species, sex)"));
  const rows = [...block.matchAll(/\('([a-z0-9-]+)', '([a-z0-9_]+)', '([mf])'\)/g)].map((m) => [m[1], { species: m[2], sex: m[3] }]);
  assert.deepEqual(Object.fromEntries(rows), { ...C.SKIN_SPECIES });
});
