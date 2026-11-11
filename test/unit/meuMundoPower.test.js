// test/unit/meuMundoPower.test.js — MEU MUNDO 3D: PODER do personagem (B7, 2026-11-08)
//
// Fórmula decidida pelo Alex: força + velocidade + destreza + inteligência + acurácia
// + HP máx do nível + equipamento (1% de bônus = 10 pontos). Só o permanente, sem suplemento.
// A fórmula mora no front (features/meu-mundo/power/power.ts) e o back roda a cópia
// GERADA (src/utils/meuMundoPower.js). Aqui: a cópia está em dia; a fórmula; e o ESPELHO:
// o TS do front (power.ts + fight.ts, importados direto pelo Node) e as cópias do back dão
// o MESMO poder.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { pathToFileURL } = require("url");
const path = require("path");
const P = require("../../src/utils/meuMundoPower");
const F = require("../../src/utils/meuMundoFight");
const Gear = require("../../src/utils/meuMundoGear");
const L = require("../../src/utils/meuMundoLife");

process.removeAllListeners("warning");

const gen = require("../../scripts/build-power-sim");
const FRONT_FIGHT = path.resolve(gen.SIM, "../laminas/sim/fight.ts");

const ATTRS = { strength: 300, speed: 200, dexterity: 150, intelligence: 400, accuracy: 50 };

test("poder — a cópia do back está em dia com o front", (t) => {
  if (!fs.existsSync(gen.SIM)) return t.skip("front fora do lugar");
  const cur = fs.readFileSync(gen.OUT, "utf8").replace(/\r\n/g, "\n");
  assert.equal(cur, gen.build(), "rode node scripts/build-power-sim.js");
});

test("poder — soma simples dos 5 atributos + HP máx do nível + 10 por 1% de equipamento", () => {
  const p = P.powerScore(F, { attrs: ATTRS, level: 1, gear: {} });
  assert.equal(p.total, 300 + 200 + 150 + 400 + 50 + 100);
  assert.deepEqual(p.parts, { strength: 300, speed: 200, dexterity: 150, intelligence: 400, accuracy: 50, hp: 100, gear: 0 });
  assert.equal(P.powerOf(F, { attrs: ATTRS, level: 1 }), p.total);
});

test("poder — HP máx = o do nível de aventura (100 + 9 por nível), igual à regra da luta", () => {
  for (const level of [1, 2, 10, 60, 120]) {
    const p = P.powerScore(F, { attrs: {}, level, gear: {} });
    assert.equal(p.parts.hp, F.heroLevelScale(level).hp);
    assert.equal(p.total, 100 + 9 * (level - 1));
  }
  // nível ausente/0 = 1
  assert.equal(P.powerOf(F, { attrs: {}, level: 0 }), 100);
});

test("poder (E4, A13) — o equipamento vale o que soma DE VERDADE à ficha no nível", () => {
  // nível 1: base 100, vida 100; fôlego/aviso/barra = 1.000 por 1,0
  const p = P.powerScore(F, { attrs: {}, level: 1, gear: { dmg: 0.1, def: 0.05, stam: 0.02, warn: 0.01, power: 0.03 } });
  assert.equal(p.parts.gear, Math.round(0.1 * 100 + 0.05 * 100 + 1000 * 0.06)); // 75
  assert.equal(p.total, 100 + p.parts.gear);
  // a conta do plano (§8 E4): nível 30, atributos 300, tudo no teto
  const base = 100 + (900 * 29) / 59, vida = 100 + 9 * 29, ac = 100 + 300 + 3 * 29;
  const want = 0.35 * base + 0.25 * base + 0.25 * vida + 0.2 * ac + 0.15 * ac + 0.15 * 300 + 0.15 * 300 + 420;
  const a = { strength: 300, speed: 300, dexterity: 300, intelligence: 300, accuracy: 300 };
  assert.equal(P.powerScore(F, { attrs: a, level: 30, gear: Gear.GEAR_CAP }).parts.gear, Math.round(want));
  assert.equal(Math.round(want), 1096);
});

test("poder — equipamento no teto vale o teto (gearBonus já corta)", () => {
  const all = {};
  let i = 0;
  for (const g of Gear.GEAR) if (g.bonus && i < 5) all[Gear.SLOTS[i++]] = { id: g.id, level: 99 };
  const capped = Gear.gearBonus(all);
  for (const [k, v] of Object.entries(capped)) assert.ok(v <= Gear.GEAR_CAP[k] + 1e-9, `${k} acima do teto`);
  // nível 1, sem atributos: ficha = 100 em tudo; inteligência e destreza 0
  const C = Gear.GEAR_CAP;
  const p = P.powerScore(F, { attrs: {}, level: 1, gear: C });
  assert.equal(p.parts.gear, Math.round(100 * (C.dmg + C.def + C.hp + C.acc + C.spd) + P.GEAR_FLAT * (C.stam + C.warn + C.power)));
});

test("poder — valores inválidos ou negativos não somam; total é inteiro", () => {
  const p = P.powerScore(F, { attrs: { strength: -5, speed: "x", dexterity: null, intelligence: 10.4, accuracy: 0.3 }, level: 1, gear: { dmg: -1 } });
  assert.equal(p.total, Math.round(10.4 + 0.3 + 100));
  assert.ok(Number.isInteger(p.total));
});

test("poder — só o permanente: sem suplemento, sem o bônus de nível da luta", () => {
  assert.equal(P.SUPPLEMENT_POWER, undefined);
  // o bônus de atributo do nível (heroLevelScale.attr) só vale na luta
  const a = P.powerOf(F, { attrs: ATTRS, level: 30 });
  assert.equal(a, 1100 + F.heroLevelScale(30).hp);
  // o nome não colide com a barra de golpe máximo da luta
  assert.ok(F.POWER && typeof F.POWER === "object");
});

test("acurácia: atributo de prática novo, nasce em 0, mesma escala/decaimento dos outros", () => {
  assert.ok(L.ATTRS.includes("accuracy"));
  assert.equal(L.ATTR.DECAY_DAY.accuracy, L.ATTR.DECAY_DAY.dexterity);
  assert.equal(L.ATTR.FLOOR.accuracy, L.ATTR.FLOOR.dexterity);
  const s = L.birth(42, Date.UTC(2026, 10, 8, 10));
  assert.equal(s.accuracy, 0);
  assert.equal(s.peaks.accuracy, 0);
  assert.equal(L.snapshot(s, s.simAt).attributes.accuracy, 0);
});

test("acurácia: personagem de antes (sem a chave) vira 0 ao normalizar; a queda respeita o piso", () => {
  const t0 = Date.UTC(2026, 10, 8, 10);
  const s = L.birth(43, t0);
  delete s.accuracy;
  delete s.peaks.accuracy;
  L.simulate(s, t0 + L.HOUR, { coins: 0 }, {});
  assert.equal(s.accuracy, 0);
  s.accuracy = 100;
  s.peaks.accuracy = 100;
  s.practiced = { ...(s.practiced || {}), accuracy: s.simAt };
  L.simulate(s, s.simAt + 4 * 24 * L.HOUR, { coins: 0 }, {});
  assert.ok(s.accuracy < 100 && s.accuracy >= 60 - 1e-9, `acurácia ${s.accuracy}`);
});

test("poder — ESPELHO: o TS do front e o back dão o mesmo número", async (t) => {
  if (!fs.existsSync(gen.SIM) || !fs.existsSync(FRONT_FIGHT)) return t.skip("front fora do lugar");
  const FP = await import(pathToFileURL(path.join(gen.SIM, "power.ts")).href);
  const FF = await import(pathToFileURL(FRONT_FIGHT).href);
  const gears = [null, { dmg: 0.12, power: 0.08 }, { def: 0.25, stam: 0.12, warn: 0.12 }, { dmg: 0.35, def: 0.25, stam: 0.12, warn: 0.12, power: 0.18 }];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let n = 0;
  for (const gear of gears) {
    for (let i = 0; i < 40; i++) {
      const input = {
        level: Math.floor(rnd() * 120),
        attrs: { strength: rnd() * 1500, speed: rnd() * 1500, dexterity: rnd() * 1500, intelligence: rnd() * 1500, accuracy: rnd() * 300 },
        gear,
      };
      assert.deepEqual(P.powerScore(F, input), FP.powerScore(FF, input), JSON.stringify(input));
      n++;
    }
  }
  assert.equal(n, gears.length * 40);
});
