// Computadores do Jetpack (2026-11-08): a cópia da regra do voo está em dia, o passo leve da
// busca é IGUAL à física da Flight (senão o caminho achado não é o voado) e o computador
// segue o caminho até onde "cansa".
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const J = require("../../src/utils/meuMundoJetpackSim");
const { JetpackBot, lite } = require("../../src/utils/meuMundoJetpackBot");

test("jetpack — a cópia do back está em dia com o front", (t) => {
  const gen = require("../../scripts/build-jetpack-sim");
  if (!fs.existsSync(gen.SIM)) return t.skip("front fora do lugar");
  const cur = fs.readFileSync(gen.OUT, "utf8").replace(/\r\n/g, "\n");
  assert.equal(cur, gen.build(), "rode node scripts/build-jetpack-sim.js");
});

test("o passo leve da busca é igual ao da Flight", () => {
  const f = new J.Flight(7919, 1.1, "canion");
  const c2 = new J.Course(7919, "canion");
  const s = { x: f.x, y: f.y, z: f.z, vx: f.vx, vy: f.vy, fuel: f.fuel, t: f.t, armed: f.armed, taken: new Set(), cans: 0 };
  const ev = [];
  for (let i = 0; i < 600 && f.alive; i++) {
    const th = i % 30 < 17;
    const sd = i % 200 < 100 ? 0.0 : i % 200 < 150 ? 1 : -1;
    f.step({ side: sd, thrust: th }, ev);
    const ok = lite(c2, s, sd, th, 1.1);
    assert.equal(ok, f.alive, `vivo diferente no passo ${i}`);
    assert.ok(Math.abs(f.y - s.y) < 1e-9 && Math.abs(f.z - s.z) < 1e-9 && Math.abs(f.x - s.x) < 1e-9, `posição diferente no passo ${i}`);
  }
});

test("o computador voa até onde cansa (a busca acha o caminho)", () => {
  const b = new JetpackBot({ seed: 1000 + 7919, phase: "industrial", k: 1, skill: 1, luck: 7 });
  b.tiredAt = 600;
  let t = 0;
  while (b.flight.alive && t < 120) {
    b.advance(0.05);
    t += 0.05;
  }
  assert.ok(b.flight.z > 550, `parou cedo: ${Math.round(b.flight.z)} m`);
  assert.equal(b.flight.alive, false, "depois de cansar, ele bate");
  const p = b.pose();
  assert.ok(p.score >= Math.floor(p.z), JSON.stringify(p));
});
