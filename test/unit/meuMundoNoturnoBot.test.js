// Computadores do Rolê Noturno (2026-11-08): a cópia da regra está em dia, o computador é
// repetível pela semente e quem tem mais habilidade vai mais longe na média.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { NoturnoBot } = require("../../src/utils/meuMundoNoturnoBot");

test("noturno — a cópia do back está em dia com o front", (t) => {
  const gen = require("../../scripts/build-noturno-sim");
  if (!fs.existsSync(gen.SIM)) return t.skip("front fora do lugar");
  const cur = fs.readFileSync(gen.OUT, "utf8").replace(/\r\n/g, "\n");
  assert.equal(cur, gen.build(), "rode node scripts/build-noturno-sim.js");
});

function ride(skill, s) {
  const b = new NoturnoBot({ ride: "skate", seed: s * 7919, street: "bike", skill, luck: s * 31 });
  let t = 0;
  while (b.run.alive && t < 600) {
    b.advance(0.05);
    t += 0.05;
  }
  return Math.round(b.run.z);
}

test("o computador é repetível (mesma semente, mesmo resultado)", () => {
  assert.equal(ride(0.5, 3), ride(0.5, 3));
});

test("o computador anda, pontua e um dia cai", () => {
  const b = new NoturnoBot({ ride: "bike", seed: 99, street: "bike", skill: 0.3, luck: 5 });
  let t = 0;
  while (b.run.alive && t < 900) {
    b.advance(0.05);
    t += 0.05;
  }
  const p = b.pose();
  assert.ok(p.z > 100 && p.score > 100, JSON.stringify(p));
  assert.equal(p.alive, false, "um computador fraco cai antes de 15 min");
});

test("mais habilidade vai mais longe (média de 6 corridas)", () => {
  const avg = (k) => [1, 2, 3, 4, 5, 6].reduce((a, s) => a + ride(k, s), 0) / 6;
  assert.ok(avg(0.85) > avg(0.15), "habilidade não fez diferença");
});
