// Computadores do Paint (2026-11-08): em todos os mapas, dois computadores de times opostos
// saem da base, sobem pela rota (ponte e cama elástica) e pegam gatinhos — só pela partida,
// como um aparelho faria.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../src/utils/meuMundoPaint");
const { PaintBot } = require("../../src/utils/meuMundoPaintBot");

for (const { id } of P.PAINT_MAPS) {
  test(`paint ${id} — os computadores sobem e pegam gatinhos`, () => {
    const m = new P.PaintMatch(
      "1v1",
      [
        { slot: 0, team: 0, sit: 0 },
        { slot: 1, team: 1, sit: 0 },
      ],
      P.buildPaintMap("1v1", id),
    );
    m.tick(P.TUNING.countdown + 0.01);
    const bots = [new PaintBot(m, 0, 0.8, 3), new PaintBot(m, 1, 0.8, 9)];
    const y0 = bots.map((b) => b.b.y);
    for (let s = 0; s < 60 / P.TUNING.step; s++) {
      for (const b of bots) b.step();
      m.tick(P.TUNING.step);
      for (const e of m.drain()) if (e.type === "respawn") bots.find((x) => x.slot === e.slot)?.respawn(e);
    }
    for (const [i, b] of bots.entries()) {
      assert.ok(m.players.get(b.slot).cats >= 2, `${id} vaga ${i}: só ${m.players.get(b.slot).cats} gatinhos`);
      assert.ok(b.b.y > y0[i] + 1, `${id} vaga ${i}: não subiu (${y0[i]} → ${b.b.y.toFixed(1)})`);
    }
  });
}
