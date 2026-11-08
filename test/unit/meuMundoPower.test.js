// test/unit/meuMundoPower.test.js — MEU MUNDO 3D: PODER do personagem (T3, 2026-11-08)
//
// A fórmula mora no front (features/meu-mundo/power/power.ts) e o back roda a
// cópia GERADA (src/utils/meuMundoPower.js). Aqui: a cópia está em dia; a fórmula
// decidida com o Alex (HP×0,5 + ataque×3 + defesa×2 + (força+velocidade+int)×10
// + equipamento, arredondado); e o ESPELHO: o TS do front (power.ts + fight.ts,
// importados direto pelo Node) e as cópias do back dão o MESMO poder.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { pathToFileURL } = require("url");
const path = require("path");
const P = require("../../src/utils/meuMundoPower");
const F = require("../../src/utils/meuMundoFight");

process.removeAllListeners("warning");

const gen = require("../../scripts/build-power-sim");
const FRONT_FIGHT = path.resolve(gen.SIM, "../laminas/sim/fight.ts");

test("poder — a cópia do back está em dia com o front", (t) => {
  if (!fs.existsSync(gen.SIM)) return t.skip("front fora do lugar");
  const cur = fs.readFileSync(gen.OUT, "utf8").replace(/\r\n/g, "\n");
  assert.equal(cur, gen.build(), "rode node scripts/build-power-sim.js");
});

test("poder — fórmula: HP×0,5 + ataque×3 + defesa×2 + atributos×10, inteiro", () => {
  assert.equal(P.computePower({ hp: 100, atk: 100, def: 100, strength: 10, speed: 10, intelligence: 10 }), 850);
  assert.equal(P.computePower({ hp: 0, atk: 0, def: 0, strength: 0, speed: 0, intelligence: 0 }), 0);
  // cada peso isolado
  assert.equal(P.computePower({ hp: 3, atk: 0, def: 0, strength: 0, speed: 0, intelligence: 0 }), 2); // 1,5 → 2
  assert.equal(P.computePower({ hp: 0, atk: 7, def: 0, strength: 0, speed: 0, intelligence: 0 }), 21);
  assert.equal(P.computePower({ hp: 0, atk: 0, def: 9, strength: 0, speed: 0, intelligence: 0 }), 18);
  assert.equal(P.computePower({ hp: 0, atk: 0, def: 0, strength: 1, speed: 2, intelligence: 3 }), 60);
  // lixo e negativo valem 0; nunca NaN
  assert.equal(P.computePower({ hp: NaN, atk: -50, def: "x", strength: null, speed: undefined, intelligence: 1 }), 10);
});

test("poder — equipamento soma pontos fixos; suplementos dão % com teto", () => {
  const st = { hp: 100, atk: 100, def: 100, strength: 10, speed: 10, intelligence: 10 };
  assert.equal(P.computePower(st, { dmg: 0.1 }), 850 + 150);
  assert.equal(P.computePower(st, { dmg: 0.1, def: 0.05, stam: 0.03, warn: 0.02, power: 0.05 }), Math.round(850 + 150 + 75 + 30 + 20 + 60));
  assert.equal(P.computePower(st, { dmg: -1 }), 850);
  assert.equal(P.computePower(st, null, ["creatine"]), Math.round(850 * 1.03));
  assert.equal(P.computePower(st, null, ["creatine", "creatine"]), Math.round(850 * 1.03), "repetido conta uma vez");
  assert.equal(P.computePower(st, null, ["coffee", "stim"]), 850, "estimulante não é suplemento de força");
  const all = Object.keys(P.SUPPLEMENT_POWER);
  assert.equal(P.computePower(st, null, all), Math.round(850 * (1 + P.SUPPLEMENT_MAX)));
});

test("poder — powerOf usa a ficha da luta sem equipamento (equipamento só no bônus)", () => {
  const input = { body: "aurion", level: 15, stats: { strength: 400, speed: 300, intelligence: 200, dexterity: 50 } };
  const sheet = F.heroSheet("aurion", 15, input.stats);
  const f = F.heroStats({ ...input.stats }, 15);
  const want = Math.round(sheet.hp * 0.5 + sheet.atk * 3 + sheet.def * 2 + (f.strength + f.speed + f.intelligence) * 10);
  assert.equal(P.powerOf(F, input), want);
  // subir nível ou treinar sobe o poder
  assert.ok(P.powerOf(F, { ...input, level: 16 }) > want);
  assert.ok(P.powerOf(F, { ...input, stats: { ...input.stats, strength: 401 } }) > want);
  // nível ausente = 1
  assert.equal(P.powerOf(F, { ...input, level: 0 }), P.powerOf(F, { ...input, level: 1 }));
});

test("poder — ESPELHO: o TS do front e o back dão o mesmo número", async (t) => {
  if (!fs.existsSync(gen.SIM) || !fs.existsSync(FRONT_FIGHT)) return t.skip("front fora do lugar");
  const FP = await import(pathToFileURL(path.join(gen.SIM, "power.ts")).href);
  const FF = await import(pathToFileURL(FRONT_FIGHT).href);
  const bodies = [null, "normal", "magro", "aurion", "kragor", "vampira_adulta", "raposa", "ciborgue"];
  const gears = [null, { dmg: 0.12, power: 0.08 }, { def: 0.25, stam: 0.12, warn: 0.12 }, { dmg: 0.35, def: 0.25, stam: 0.12, warn: 0.12, power: 0.18 }];
  const sups = [[], ["creatine"], ["preworkout", "whey", "anabolic"], ["coffee"]];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let n = 0;
  for (const body of bodies) {
    for (const gear of gears) {
      for (const supplements of sups) {
        const input = {
          body,
          level: 1 + Math.floor(rnd() * 80),
          stats: { strength: Math.floor(rnd() * 1500), speed: Math.floor(rnd() * 1500), intelligence: Math.floor(rnd() * 1500), dexterity: Math.floor(rnd() * 1500) },
          gear,
          supplements,
        };
        const front = FP.powerOf(FF, input);
        const back = P.powerOf(F, input);
        assert.equal(back, front, JSON.stringify(input));
        assert.ok(Number.isInteger(back));
        n++;
      }
    }
  }
  assert.equal(n, bodies.length * gears.length * sups.length);
});
