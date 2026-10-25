// Geladeira nas plantas e fôlego de corrida (mm3d-28).
const test = require("node:test");
const assert = require("node:assert/strict");
const { interiorFor } = require("../../src/utils/meuMundoInteriors");
const { isFreeSpot } = require("../../src/utils/meuMundoInteriorMotion");
const { FRIDGE_REACH } = require("../../src/utils/meuMundoInteriorKit");
const { freshStamina, setStamina, staminaIntent, STAMINA } = require("../../src/utils/meuMundoMotion");

test("toda casa (níveis 1–9) tem uma geladeira com lugar livre em frente, olhando para ela", () => {
  for (let level = 1; level <= 9; level++) {
    const d = interiorFor(level);
    assert.ok(d.fridges && d.fridges.length >= 1, `nível ${level}: ${JSON.stringify(d.warnings || [])}`);
    for (const f of d.fridges) {
      assert.ok(isFreeSpot(d, f.floor, f.x, f.z), `nível ${level}: ponto ocupado`);
      const dist = Math.hypot(f.center.x - f.x, f.center.z - f.z);
      assert.ok(dist < 1.4, `nível ${level}: longe (${dist})`);
      // olhando para o móvel
      const dir = Math.atan2(f.center.x - f.x, f.center.z - f.z);
      const diff = Math.abs(Math.atan2(Math.sin(dir - f.facing), Math.cos(dir - f.facing)));
      assert.ok(diff < 0.8, `nível ${level}: de costas (${diff})`);
    }
  }
  assert.ok(FRIDGE_REACH >= 1);
});

test("fôlego: corre até acabar, depois só anda até recuperar 30%; parado recarrega", () => {
  const st = freshStamina({ maxS: 10, refillS: 20 });
  const run = { x: 1, z: 0, run: true };
  let t = 0;
  while (!st.winded && t < 30) {
    assert.equal(staminaIntent(st, run, 0.05).run, true);
    t += 0.05;
  }
  assert.ok(Math.abs(t - 10) < 0.11, `correu ${t} s`);
  assert.equal(staminaIntent(st, run, 0.05).run, false, "sem fôlego: anda");
  // recarga: 10 s cheios em 20 s → 30% em 6 s
  let r = 0;
  while (st.winded) {
    staminaIntent(st, run, 0.05);
    r += 0.05;
  }
  assert.ok(Math.abs(r - 6.05) < 0.2, `recuperou em ${r} s`);
  // pedir corrida parado não gasta
  const idle = freshStamina({ maxS: 10, refillS: 20 });
  staminaIntent(idle, { x: 0, z: 0, run: true }, 5);
  assert.equal(idle.left, 10);
  // a vida reduz o fôlego mantendo a fração
  setStamina(idle, { maxS: 5, refillS: 40 });
  assert.equal(idle.left, 5);
  assert.equal(STAMINA.RECOVER_AT, 0.3);
});
