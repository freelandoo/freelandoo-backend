// Vida do bee pelo embalo (mig 420, utils/beeLife.js).
const test = require("node:test");
const assert = require("node:assert");
const { BEE_LIFE, momentumNow, beeAlive, addMomentum, keepFloor } = require("../../src/utils/beeLife");

const H = 3.6e6;
const now = Date.parse("2026-11-08T12:00:00Z");
const ago = (h) => new Date(now - h * H).toISOString();

test("embalo perde metade a cada meia-vida", () => {
  assert.strictEqual(momentumNow(100, ago(0), now), 100);
  assert.ok(Math.abs(momentumNow(100, ago(BEE_LIFE.HALF_LIFE_HOURS), now) - 50) < 1e-9);
  assert.ok(Math.abs(momentumNow(100, ago(2 * BEE_LIFE.HALF_LIFE_HOURS), now) - 25) < 1e-9);
  assert.strictEqual(momentumNow(0, ago(1), now), 0);
});

test("carência: as primeiras 24 h sempre no ar, mesmo sem ponto", () => {
  assert.ok(beeAlive({ created_at: ago(23.9), momentum: 0, momentum_peak: 0 }, now));
  assert.ok(!beeAlive({ created_at: ago(24.1), momentum: 0, momentum_peak: 0 }, now));
  assert.ok(!beeAlive({ created_at: ago(1), deleted_at: ago(0.5) }, now));
});

test("sem teto: segue no ar enquanto continua crescendo (30 dias)", () => {
  const row = { created_at: ago(30 * 24), momentum: 400, momentum_at: ago(1), momentum_peak: 600 };
  assert.ok(beeAlive(row, now));
});

test("some quando o crescimento cai muito em relação ao pico", () => {
  // pico 1000, parou de ganhar: piso = 150; 1000 → 150 em 12·log2(1000/150) ≈ 32,8 h
  const at = (h) => ({ created_at: ago(5 * 24), momentum: 1000, momentum_at: ago(h), momentum_peak: 1000 });
  assert.ok(beeAlive(at(32), now));
  assert.ok(!beeAlive(at(34), now));
  // pequeno: piso absoluto 10
  assert.strictEqual(keepFloor(20), BEE_LIFE.MIN_MOMENTUM);
});

test("ganho soma no embalo decaído e o pico só sobe", () => {
  const r = { momentum: 100, momentum_at: ago(12), momentum_peak: 300 };
  const a = addMomentum(r, 10, now);
  assert.ok(Math.abs(a.momentum - 60) < 1e-9);
  assert.strictEqual(a.peak, 300);
  const b = addMomentum({ momentum: 0, momentum_peak: 0 }, -5, now);
  assert.strictEqual(b.momentum, 0);
});
