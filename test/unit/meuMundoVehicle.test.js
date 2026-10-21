// Física do carro do Meu Mundo (mm3d-12). Os números aqui são o comportamento
// que o jogador sente: parado não gira, acelera e freia progressivamente, ré
// mais lenta, curva estável, freio de mão faz a traseira escapar e o
// contraesterço recupera, choque não atravessa parede, e o resultado não
// depende da taxa de quadros. Também confere que o espelho do cliente
// (features/meu-mundo/engine/vehicle.ts) tem as MESMAS constantes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const V = require("../../src/utils/meuMundoVehicle");

const GAS = { t: 1, b: 0, s: 0, h: false };
const IDLE = { t: 0, b: 0, s: 0, h: false };

function run(c, input, seconds, boxes = []) {
  const n = Math.round(seconds / V.STEP);
  for (let i = 0; i < n; i++) V.stepVehicle(c, input, boxes, 1e4);
  return c;
}

test("parado, o volante esterça as rodas mas a carroceria não gira", () => {
  const c = V.createVehicle(0, 0, 0);
  run(c, { t: 0, b: 0, s: 1, h: false }, 2);
  assert.ok(c.steer > 0.5, `rodas esterçadas ${c.steer}`);
  assert.equal(c.yaw, 0);
  assert.equal(c.x, 0);
  assert.equal(c.z, 0);
  // Freio de mão parado também não gira nada.
  run(c, { t: 0, b: 0, s: -1, h: true }, 1);
  assert.equal(c.yaw, 0);
});

test("aceleração progressiva até a velocidade máxima, sem passar dela", () => {
  const c = V.createVehicle(0, 0, 0);
  run(c, GAS, 1);
  const at1 = c.u;
  run(c, GAS, 2);
  const at3 = c.u;
  assert.ok(at1 > 2 && at1 < 7, `1 s: ${at1}`);
  assert.ok(at3 > at1 * 1.8, `3 s: ${at3}`);
  run(c, GAS, 30);
  assert.ok(c.u <= V.VEHICLE.MAX_SPEED + 1e-6, `máxima ${c.u}`);
  assert.ok(c.u > V.VEHICLE.MAX_SPEED * 0.85, `chega perto da máxima ${c.u}`);
});

test("frenagem previsível: para sem engatar ré sozinho; ré só depois de parado", () => {
  const c = V.createVehicle(0, 0, 0);
  run(c, GAS, 5);
  const v0 = c.u;
  run(c, { t: 0, b: 1, s: 0, h: false }, 0.5);
  const decel = (v0 - c.u) / 0.5;
  assert.ok(decel > 6 && decel < 11, `desaceleração ${decel}`);
  run(c, { t: 0, b: 1, s: 0, h: false }, 1.6);
  assert.ok(Math.abs(c.u) < 0.35, `parou: ${c.u}`);
  // Segurando o freio parado, engata a ré — mais lenta que a frente.
  run(c, { t: 0, b: 1, s: 0, h: false }, 6);
  assert.ok(c.u < -2, `ré ${c.u}`);
  assert.ok(c.u >= -V.VEHICLE.REVERSE_SPEED - 1e-6, `ré limitada ${c.u}`);
  assert.equal(c.gear, -1);
});

test("acelerador andando de ré freia antes de ir para a frente", () => {
  const c = V.createVehicle(0, 0, 0);
  run(c, { t: 0, b: 1, s: 0, h: false }, 4);
  assert.ok(c.u < -2);
  run(c, GAS, 0.3);
  assert.ok(c.u < 0 && c.u > -2.5, `freando a ré: ${c.u}`);
});

test("curva rápida estável: sai de frente, não roda", () => {
  const c = V.createVehicle(0, 0, 0);
  run(c, GAS, 4);
  let maxBeta = 0;
  for (let i = 0; i < 180; i++) {
    V.stepVehicle(c, { t: 1, b: 0, s: 1, h: false }, [], 1e4);
    maxBeta = Math.max(maxBeta, Math.abs(c.beta));
  }
  assert.ok(c.yaw > 0.8, `virou ${c.yaw}`);
  assert.ok(maxBeta < 0.15, `deslizamento ${maxBeta}`);
  assert.ok(c.u > 10, `mantém velocidade ${c.u}`);
});

test("menos esterçamento em alta velocidade", () => {
  const slow = V.createVehicle(0, 0, 0);
  run(slow, { t: 0.15, b: 0, s: 0, h: false }, 1);
  run(slow, { t: 0.15, b: 0, s: 1, h: false }, 1);
  const fast = V.createVehicle(0, 0, 0);
  run(fast, GAS, 5);
  run(fast, { t: 1, b: 0, s: 1, h: false }, 1);
  assert.ok(fast.steer < slow.steer * 0.6, `rápido ${fast.steer} × devagar ${slow.steer}`);
});

test("volante volta ao centro aos poucos", () => {
  const c = V.createVehicle(0, 0, 0);
  run(c, { t: 0, b: 0, s: 1, h: false }, 1);
  const full = c.steer;
  run(c, IDLE, 0.05);
  assert.ok(c.steer > 0 && c.steer < full, `voltando ${c.steer}`);
  run(c, IDLE, 1);
  assert.equal(c.steer, 0);
});

test("freio de mão: traseira escapa, contraesterço recupera, termina suave", () => {
  const c = V.createVehicle(0, 0, 0);
  run(c, GAS, 5);
  let peak = 0;
  let slipped = 0;
  for (let i = 0; i < 72; i++) {
    V.stepVehicle(c, { t: 0.6, b: 0, s: 0.8, h: true }, [], 1e4);
    peak = Math.max(peak, Math.abs(c.beta));
    slipped = Math.max(slipped, c.slip);
  }
  for (let i = 0; i < 90; i++) {
    V.stepVehicle(c, { t: 0.7, b: 0, s: -0.4, h: false }, [], 1e4);
    peak = Math.max(peak, Math.abs(c.beta));
  }
  assert.ok(slipped > 0.8, `traseira no limite ${slipped}`);
  assert.ok(peak > 0.3, `derrapou ${peak}`);
  assert.ok(peak < 1.2, `não rodou (rodar é passar de ~70°) ${peak}`);
  run(c, { t: 0.5, b: 0, s: 0, h: false }, 1.5);
  assert.ok(Math.abs(c.beta) < 0.05, `recuperou ${c.beta}`);
  assert.ok(Math.abs(c.w) < 0.05, `guinada parou ${c.w}`);
  assert.ok(c.u > 4, `continua andando ${c.u}`);
});

test("não depende da taxa de quadros (passo fixo com acumulador)", () => {
  const plan = [
    [2, GAS],
    [1.5, { t: 1, b: 0, s: 0.7, h: false }],
    [1, { t: 0.5, b: 0, s: -1, h: true }],
    [1, { t: 0, b: 1, s: 0, h: false }],
  ];
  const finals = [30, 60, 144].map((fps) => {
    const c = V.createVehicle(0, 0, 0);
    for (const [secs, input] of plan) {
      const frames = Math.round(secs * fps);
      for (let i = 0; i < frames; i++) V.advanceVehicle(c, input, 1 / fps, [], 1e4);
    }
    return c;
  });
  for (const c of finals.slice(1)) {
    assert.ok(Math.hypot(c.x - finals[0].x, c.z - finals[0].z) < 0.6, `posição ${c.x},${c.z} × ${finals[0].x},${finals[0].z}`);
    assert.ok(Math.abs(c.yaw - finals[0].yaw) < 0.05, `rumo ${c.yaw} × ${finals[0].yaw}`);
  }
});

test("aba que volta não simula o tempo perdido", () => {
  const c = V.createVehicle(0, 0, 0);
  const n = V.advanceVehicle(c, GAS, 30, [], 1e4);
  assert.equal(n, V.MAX_STEPS);
});

test("parede para o carro (não atravessa) e o choque tira velocidade", () => {
  const wall = { x: 0, z: 20, hx: 60, hz: 0.15, rot: 0, h: 2 };
  const c = V.createVehicle(0, 0, 0);
  for (let i = 0; i < 600; i++) V.stepVehicle(c, GAS, [wall], 1e4);
  assert.ok(c.z < 20 - V.VEHICLE.COL_OFFSET, `ficou antes do muro: ${c.z}`);
  assert.ok(Math.abs(c.u) < 3, `parado no muro ${c.u}`);
  // Batida em ângulo raspa e muda o rumo.
  const d = V.createVehicle(-5, 0, 0.6);
  for (let i = 0; i < 300; i++) V.stepVehicle(d, GAS, [wall], 1e4);
  assert.ok(d.z < 20, `não atravessou ${d.z}`);
});

test("parado e sem comando, não treme", () => {
  const c = V.createVehicle(3, 4, 1);
  run(c, IDLE, 3);
  assert.deepEqual([c.x, c.z, c.yaw], [3, 4, 1]);
});

test("entrada da rede é limitada; ajuste fora da faixa vai para a borda", () => {
  assert.deepEqual(V.sanitizeDrive({ t: 5, b: -1, s: 9, h: 1 }), { t: 1, b: 0, s: 1, h: true });
  assert.deepEqual(V.sanitizeDrive({ t: "x", s: NaN }), { t: 0, b: 0, s: 0, h: false });
  assert.equal(V.sanitizeDrive(null), null);
  const tu = V.sanitizeTuning({ MAX_SPEED: 999, ASSIST: -3, MASS: 1, GRIP_REAR: 1.4 });
  assert.equal(tu.MAX_SPEED, V.TUNING_RANGES.MAX_SPEED[1]);
  assert.equal(tu.ASSIST, 0);
  assert.equal(tu.GRIP_REAR, 1.4);
  assert.ok(!("MASS" in tu), "massa não é ajustável");
});

test("constantes da física iguais no cliente", (t) => {
  const f = path.join(__dirname, "../../../freelandoo frontend/freelandoo-website-main/features/meu-mundo/engine/vehicle.ts");
  if (!fs.existsSync(f)) return t.skip("frontend não está ao lado");
  const src = fs.readFileSync(f, "utf8");
  const start = src.indexOf("export const VEHICLE");
  const block = src.slice(start, src.indexOf("}", start));
  for (const [k, v] of Object.entries(V.VEHICLE)) {
    const m = block.match(new RegExp(`\\b${k}:\\s*([0-9.]+)`));
    assert.ok(m, `VEHICLE.${k} ausente no cliente`);
    assert.equal(Number(m[1]), v, `VEHICLE.${k}`);
  }
  for (const [k, [lo, hi]] of Object.entries(V.TUNING_RANGES)) {
    assert.ok(new RegExp(`${k}:\\s*\\[${lo},\\s*${hi}\\]`).test(src), `faixa ${k}`);
  }
  assert.ok(/STEP\s*=\s*1\s*\/\s*60/.test(src) && /MAX_STEPS\s*=\s*8/.test(src), "passo fixo");
  // Modalidades (mm3d-14): mesma forma de colisão no cliente.
  const ks = src.slice(src.indexOf("export const KINDS"), src.indexOf("} as const", src.indexOf("export const KINDS")));
  for (const [kind, ov] of Object.entries(V.KINDS)) {
    const line = ks.split("\n").find((l) => l.trim().startsWith(`${kind}:`));
    assert.ok(line, `KINDS.${kind} ausente no cliente`);
    for (const [k, v] of Object.entries(ov)) assert.ok(new RegExp(`${k}:\\s*${v}\\b`).test(line), `KINDS.${kind}.${k}`);
  }
});

test("bike, skate e patins andam como o carro: mesma velocidade, forma menor", () => {
  const out = {};
  for (const kind of Object.keys(V.KINDS)) {
    const c = V.createVehicle(0, 0, 0);
    const P = V.paramsFor(kind, null);
    for (let i = 0; i < 6 * 60; i++) V.stepVehicle(c, { t: 1, b: 0, s: 0, h: false }, [], 1e9, P);
    out[kind] = c.u;
  }
  for (const kind of Object.keys(out)) assert.ok(Math.abs(out[kind] - out.car) < 1e-9, `${kind} ${out[kind]} × carro ${out.car}`);
  assert.ok(V.paramsFor("bike").COL_RADIUS < V.VEHICLE.COL_RADIUS);
  assert.equal(V.paramsFor("car"), V.VEHICLE);
  assert.equal(V.paramsFor("bike", { MAX_SPEED: 10 }).MAX_SPEED, 10);
});
