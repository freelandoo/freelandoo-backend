// test/unit/meuMundoDriveSync.test.js — MEU MUNDO 3D: volante marcado pelo passo (mm3d-22)
//
// Celular (car-sync.ts do front: degraus do volante e reconciliação) contra a
// sala (meuMundoDriveSync.js) com atraso e oscilação de rede, numa estrada em
// S. Prova: com o passo marcado, o trajeto da sala é o MESMO do celular e a
// reconciliação não tem o que corrigir (antes: ~0,3 m de lado a cada estado,
// o "empurrado para o lado nas curvas").

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const V = require("../../src/utils/meuMundoVehicle");
const { DRIVE_EVERY, queueDrive, advanceDriven } = require("../../src/utils/meuMundoDriveSync");

process.removeAllListeners("warning");

const CAR_SYNC = path.resolve(__dirname, "../../../freelandoo frontend/freelandoo-website-main/features/meu-mundo/engine/car-sync.ts");
const loadSync = () => (fs.existsSync(CAR_SYNC) ? import(pathToFileURL(CAR_SYNC).href) : null);

function rng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * 12 s: reta, depois esquerda/direita alternadas (2,5 s cada). O servidor
 * roda em voltas de 50 ms (como a sala); entradas e estados com atraso
 * `latMs` ± 40 ms. `stamped` = protocolo novo (passo marcado).
 */
function drive(sync, kind, latMs, stamped, seed = 7) {
  const rnd = rng(seed);
  const P = V.paramsFor(kind, null);
  const cli = V.createVehicle(0, 0, 0);
  const srv = V.createVehicle(0, 0, 0);
  const rec = new sync.CarReconciler();
  const inbox = [];
  const outbox = [];
  let held = { t: 0, b: 0, s: 0, h: false };
  let srvDrive = { t: 0, b: 0, s: 0, h: false };
  let n = 0;
  let lastArrive = 0;
  let maxErr = 0;
  let srvClock = 0;
  const send = (d, k, t) => {
    lastArrive = Math.max(lastArrive, t + latMs / 1000 + (rnd() - 0.5) * 0.08);
    inbox.push({ at: lastArrive, d, k });
  };
  for (let i = 0; i < 60 * 12; i++) {
    const t = i / 60;
    const steer = t < 2 ? 0 : Math.floor((t - 2) / 2.5) % 2 === 0 ? 0.8 : -0.8;
    const want = { t: 1, b: 0, s: steer + 0.03 * Math.sin(t * 9), h: false };
    // celular
    if (stamped) {
      if (n % sync.DRIVE_EVERY === 0) {
        const q = sync.quantizeDrive(want);
        if (!sync.sameDrive(q, held)) {
          held = q;
          send(q, n + 1, t);
        }
      }
    } else if (i % 4 === 0) {
      // antes: volante como está, mensagem a cada ~66 ms
      held = want;
      send(want, -1, t);
    }
    V.stepVehicle(cli, held, [], 1e9, P);
    n++;
    // sala: voltas de 50 ms
    while (srvClock + 0.05 <= t + 1e-9) {
      srvClock += 0.05;
      while (inbox.length && inbox[0].at <= srvClock) {
        const m = inbox.shift();
        if (m.k >= 0) queueDrive(srv, m.d, m.k);
        else srvDrive = m.d;
      }
      advanceDriven(srv, srvDrive, 0.05, [], 1e9, P);
      outbox.push({ at: srvClock + latMs / 1000 + rnd() * 0.04, s: { x: srv.x, z: srv.z, facing: srv.yaw, vx: srv.vx, vz: srv.vz, w: srv.w } });
    }
    rec.record(cli, t * 1000);
    while (outbox.length && outbox[0].at <= t) {
      rec.observe(cli, outbox.shift().s);
      if (t > 2.5) maxErr = Math.max(maxErr, rec.err);
    }
    rec.apply(cli, 1 / 60);
  }
  return maxErr;
}

test("volante: o cliente e a sala usam o mesmo degrau (DRIVE_EVERY espelhado)", async (t) => {
  const sync = await loadSync();
  if (!sync) return t.skip("front fora do lugar");
  assert.equal(sync.DRIVE_EVERY, DRIVE_EVERY);
});

test("volante marcado pelo passo: nas curvas a sala segue o mesmo trajeto do celular", async (t) => {
  const sync = await loadSync();
  if (!sync) return t.skip("front fora do lugar");
  let worstBefore = 0;
  for (const kind of ["car", "bike", "skate", "skates"]) {
    for (const lat of [30, 80, 150]) {
      const before = drive(sync, kind, lat, false);
      const now = drive(sync, kind, lat, true);
      worstBefore = Math.max(worstBefore, before);
      assert.ok(now < 0.02, `${kind} ${lat} ms: correção ${now.toFixed(3)} m (antes ${before.toFixed(3)} m)`);
    }
  }
  assert.ok(worstBefore > 0.1, `o teste reproduz o problema antigo (pior: ${worstBefore.toFixed(3)} m)`);
});

test("volante: chegou tarde vale já e a folga cresce; cliente antigo segue como antes", () => {
  const v = V.createVehicle(0, 0, 0);
  const d = { t: 1, b: 0, s: 0.5, h: false };
  queueDrive(v, d, 10); // primeira: folga inicial
  const off = v.doff;
  v.dn = 100;
  queueDrive(v, d, 11); // muito tarde para a folga atual
  assert.equal(v.dq[v.dq.length - 1].at, 101);
  assert.ok(v.doff > off);
  const old = V.createVehicle(0, 0, 0);
  queueDrive(old, d, undefined);
  assert.equal(old.dq, null);
  assert.deepEqual(old.drive, d);
});

// ── Veículo dos outros (remote-vehicle.ts) ───────────────────────────────────

const REMOTE = path.resolve(__dirname, "../../../freelandoo frontend/freelandoo-website-main/features/meu-mundo/engine/remote-vehicle.ts");

/** Ângulo (graus) entre a frente desenhada e a direção em que o desenho anda, nas curvas. */
function watch(render, seed = 3) {
  const rnd = rng(seed);
  const P = V.paramsFor("bike", null);
  const srv = V.createVehicle(0, 0, 0);
  const inbox = [];
  let worst = 0;
  let sum = 0;
  let n = 0;
  let prev = null;
  let jerk = 0;
  let jn = 0;
  let lastSp = null;
  for (let i = 0; i < 60 * 12; i++) {
    const t = i / 60;
    const steer = t < 2 ? 0 : Math.floor((t - 2) / 2.5) % 2 === 0 ? 0.8 : -0.8;
    V.stepVehicle(srv, { t: 1, b: 0, s: steer, h: false }, [], 1e9, P);
    if (i % 6 === 0) inbox.push({ at: t + 0.08 + rnd() * 0.05, s: { x: srv.x, z: srv.z, facing: srv.yaw, vx: srv.vx, vz: srv.vz } });
    const got = [];
    while (inbox.length && inbox[0].at <= t) got.push(inbox.shift().s);
    const p = render(t, got);
    if (prev && p && t > 3) {
      const mx = p.x - prev.x;
      const mz = p.z - prev.z;
      const sp = Math.hypot(mx, mz) * 60;
      if (lastSp !== null) {
        jerk += Math.abs(sp - lastSp);
        jn++;
      }
      lastSp = sp;
      if (Math.hypot(mx, mz) > 0.05) {
        let d = Math.atan2(mx, mz) - p.facing;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        const deg = Math.abs(d) * (180 / Math.PI);
        worst = Math.max(worst, deg);
        sum += deg;
        n++;
      }
    }
    prev = p ? { ...p } : prev;
  }
  // jerk: variação média da velocidade desenhada de um quadro para o outro (m/s)
  return { worst, mean: sum / n, jerk: jerk / jn };
}

test("veículo dos outros: segue a curva sem anda-freia e com a frente acompanhando o movimento", async (t) => {
  if (!fs.existsSync(REMOTE)) return t.skip("front fora do lugar");
  const { RemoteVehicle } = await import(pathToFileURL(REMOTE).href);
  // antes: persegue o último estado (filtro exponencial a 10/s)
  const old = { x: 0, z: 0, facing: 0 };
  let target = null;
  const before = watch((t, got) => {
    if (got.length) target = got[got.length - 1];
    if (!target) return null;
    const k = 1 - Math.exp(-10 / 60);
    old.x += (target.x - old.x) * k;
    old.z += (target.z - old.z) * k;
    let d = target.facing - old.facing;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    old.facing += d * k;
    return old;
  });
  const rv = new RemoteVehicle();
  const out = { x: 0, z: 0, facing: 0 };
  const after = watch((t, got) => {
    for (const s of got) rv.push(t, s.x, s.z, s.facing, s.vx, s.vz);
    return rv.pose(t, out) ? out : null;
  });
  const fmt = (r) => `média ${r.mean.toFixed(1)}°, pior ${r.worst.toFixed(1)}°, solavanco ${r.jerk.toFixed(2)} m/s`;
  assert.ok(after.mean < 3 && after.worst < 6, `agora: ${fmt(after)} (antes: ${fmt(before)})`);
  // O que se via: anda-freia a cada pacote (velocidade desenhada pulando de quadro em quadro).
  assert.ok(after.jerk < 0.5 && after.jerk < before.jerk / 10, `agora: ${fmt(after)} (antes: ${fmt(before)})`);
});
