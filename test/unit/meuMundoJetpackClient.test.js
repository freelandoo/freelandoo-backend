// test/unit/meuMundoJetpackClient.test.js — MEU MUNDO 3D: cliente do jetpack em grupo (mm3d-21)
//
// Peças do cliente que não dependem de navegador, carregadas direto do .ts do
// front (test/unit/_frontTs.js). Sem o front ao lado, pulam.
//
// TickClock: estima o passo do servidor a partir de pings (o servidor responde
// com o passo em que recebeu), decide quanto o cliente roda À FRENTE (lead,
// para a entrada chegar antes do passo em que vale) e o ritmo do laço local.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFront } = require("./_frontTs");

process.removeAllListeners("warning");

const STEP_MS = 1000 / 120;

/** Gerador determinístico (os testes não podem depender da sorte). */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Servidor simulado: começou a partida em `startMs` (relógio do cliente) e
 * anda em voltas de 25 ms (3 passos por volta), como a sala. Os pings têm RTT
 * `rtt ± jitter`, com ida e volta assimétricas (40–60 % para cada lado).
 */
function simulate(TickClock, { rtt, jitter, seed = 1, pings = 40, startMs = 1000, every = 250 }) {
  const rand = rng(seed);
  const clock = new TickClock();
  const serverTickAt = (t) => Math.max(0, Math.floor((t - startMs) / 25) * 3);
  let now = startMs + 50;
  for (let i = 0; i < pings; i++) {
    const r = rtt + (rand() * 2 - 1) * jitter;
    const up = r * (0.4 + rand() * 0.2);
    clock.sample(now, serverTickAt(now + up), now + r);
    now += every;
  }
  return { clock, now, truth: (t) => (t - startMs) / STEP_MS };
}

test("jetpack — TickClock: com RTT 120 ± 30 ms estima o passo do servidor com erro < 3", async (t) => {
  const mod = await loadFront("net/clock.ts");
  if (!mod) return t.skip("front fora do lugar");
  for (const seed of [1, 2, 3, 4, 5]) {
    const { clock, now, truth } = simulate(mod.TickClock, { rtt: 120, jitter: 30, seed });
    for (const dt of [0, 100, 1000]) {
      const err = Math.abs(clock.serverTick(now + dt) - truth(now + dt));
      assert.ok(err < 3, `seed ${seed} +${dt} ms: erro ${err.toFixed(2)} passos`);
    }
  }
});

test("jetpack — TickClock: lead = ceil((RTT/2 + 2σ + 40 ms) / passo), no máximo 30", async (t) => {
  const mod = await loadFront("net/clock.ts");
  if (!mod) return t.skip("front fora do lugar");
  const { clock } = simulate(mod.TickClock, { rtt: 120, jitter: 30, seed: 9 });
  const expect = Math.min(30, Math.ceil((clock.rtt / 2 + 2 * clock.jitter + 40) / STEP_MS));
  assert.equal(clock.lead(), expect);
  assert.ok(clock.lead() >= Math.ceil((60 + 40) / STEP_MS), "pelo menos meio RTT + 40 ms");
  const slow = simulate(mod.TickClock, { rtt: 600, jitter: 200, seed: 9 }).clock;
  assert.equal(slow.lead(), 30, "limitado a 30 passos (250 ms)");
  const fresh = new mod.TickClock();
  assert.equal(fresh.ready, false);
  assert.ok(fresh.lead() > 0 && fresh.lead() <= 30, "sem amostra: lead padrão dentro do limite");
});

test("jetpack — TickClock: ritmo sempre em [0,96; 1,04] e salto só com erro > 30 passos", async (t) => {
  const mod = await loadFront("net/clock.ts");
  if (!mod) return t.skip("front fora do lugar");
  const { clock, now } = simulate(mod.TickClock, { rtt: 120, jitter: 30, seed: 3 });
  const target = clock.target(now);
  for (const off of [-200, -31, -30, -10, -1, 0, 1, 10, 30, 31, 200]) {
    const p = clock.pace(target + off, now);
    assert.ok(p >= 0.96 && p <= 1.04, `erro ${off}: ritmo ${p}`);
    assert.equal(clock.shouldJump(target + off, now), Math.abs(off) > 30, `erro ${off}`);
  }
  assert.ok(clock.pace(target - 10, now) > 1, "atrasado: acelera");
  assert.ok(clock.pace(target + 10, now) < 1, "adiantado: desacelera");
  assert.equal(clock.pace(target, now), 1, "no alvo: ritmo 1");
});

test("jetpack — TickClock: o laço local com o ritmo converge para o alvo sem saltar", async (t) => {
  const mod = await loadFront("net/clock.ts");
  if (!mod) return t.skip("front fora do lugar");
  const { clock, now } = simulate(mod.TickClock, { rtt: 120, jitter: 30, seed: 4 });
  let local = clock.target(now) - 20; // começou 20 passos atrás
  let tm = now;
  let err = 0;
  for (let i = 0; i < 60 * 8; i++) {
    // Como o laço do jogo: no começo do quadro, decide o ritmo e avança.
    tm += 1000 / 60;
    assert.equal(clock.shouldJump(local, tm), false);
    err = clock.target(tm) - local;
    local += (1000 / 60 / STEP_MS) * clock.pace(local, tm);
  }
  assert.ok(Math.abs(err) < 1.5, `ficou a ${err.toFixed(2)} passos`);
});

test("jetpack — TickClock: reset (partida nova) esquece o passo, mas não o RTT", async (t) => {
  const mod = await loadFront("net/clock.ts");
  if (!mod) return t.skip("front fora do lugar");
  const { clock } = simulate(mod.TickClock, { rtt: 120, jitter: 30, seed: 5 });
  const lead = clock.lead();
  clock.reset();
  assert.equal(clock.ready, false);
  assert.equal(clock.lead(), lead);
  clock.sample(0, 0, 100); // passo 0 = servidor ainda não largou: só mede o RTT
  assert.equal(clock.ready, false);
});

// ── Predição (net/predict.ts) contra o servidor (Match do back) ─────────────

const Back = require("../../src/utils/meuMundoJetpack");
const CODE = { ready: 0, flying: 1, falling: 2, out_of_fuel: 3, dead: 4 };

/** Estado da sala como o cliente recebe (espelho do mirror() da JetpackRoom). */
function stateOf(m, held, taken, broken) {
  const runners = new Map();
  for (const s of m.slots) {
    const r = m.runners[s];
    runners.set(`sess${s}`, {
      slot: s, name: "", body: "", ready: false, inMatch: true, online: true,
      st: CODE[r.state], x: r.x, y: r.y, vy: r.vy, fuel: r.fuel.value, held: !!held[s], thr: r.thrusting,
      pw: r.powerUntil, pf: r.snapshot().powered, tow: r.towed, grace: r.graceUntil, pid: r.passedId,
      pass: r.passed, ph: r.phase, fc: r.fuelCollected, got: r.pickupsTaken, sm: r.smashed, dieAt: r.deathTick, place: 0,
    });
  }
  return { phase: "running", seed: m.seed, tick: m.ticks, until: 0, runners, taken: new Map(taken), broken: new Map(broken), vulcans: [...m.track.vulcans] };
}

/** Segura até a altura alvo (com a frenagem). */
const hover = (r, target) =>
  r.vy < 0
    ? r.y - (r.vy * r.vy) / (2 * (Back.TUNING.thrust - Back.TUNING.gravity)) - 0.1 < target
    : r.y + (r.vy * r.vy) / (2 * Back.TUNING.gravity) + 0.1 < target;
/** Botão roteirizado dos outros (por vaga e passo). */
const script = (s, k) => (k + s * 37) % 50 < 27;

/**
 * Servidor e cliente (vaga 0) andando juntos, passo a passo. Entrada do
 * cliente chega ao servidor `oneWay` passos depois; estado a cada 6 passos
 * (50 ms), também `oneWay` depois. O cliente roda `lead` passos à frente.
 */
function race(PartySim, { rttMs, lead, oracle = false, seed = 77, slots = [0, 1, 2, 3], ticks = 2400 }) {
  const oneWay = Math.round(rttMs / 2 / STEP_MS);
  const server = new Back.Match(seed, slots, Back.TUNING);
  server.start();
  const inbox = []; // { at, k, h }
  const outbox = []; // { at, state }
  const pending = [];
  const taken = new Map();
  const broken = new Map();
  const held = [false, false, false, false];
  let T = 0;
  let changes = 0;
  const sim = new PartySim(seed, slots, 0, {
    send: (k, h) => {
      changes++;
      inbox.push({ at: T + oneWay, k, h });
    },
    ghostHeld: oracle ? script : undefined,
  });
  let maxErr = 0;
  // Contagem: o botão da largada sai antes do "vai" (a sala aceita a entrada na
  // contagem) e, no "vai", o cliente salta para `lead` passos à frente.
  T = -1000;
  sim.prime(hover(sim.runner, 7));
  sim.advance(lead, hover(sim.runner, 7));
  for (T = 1; T <= ticks && server.aliveCount() > 0; T++) {
    // servidor: entradas que chegaram antes do passo T (atrasadas valem em T)
    while (inbox.length && inbox[0].at <= T) {
      const e = inbox.shift();
      pending.push({ k: Math.max(e.k, T), h: e.h });
    }
    while (pending.length && pending[0].k <= T) held[0] = pending.shift().h;
    for (const s of slots) if (s !== 0) held[s] = script(s, T);
    server.step(held);
    for (const e of server.drain()) {
      if (e.type === "pickup") taken.set(String(e.id), e.slot);
      else if (e.type === "smash") broken.set(String(e.obstacle), (broken.get(String(e.obstacle)) || 0) | (1 << e.piece));
    }
    if (T % 6 === 0) outbox.push({ at: T + oneWay, state: stateOf(server, held, taken, broken) });
    // cliente
    while (outbox.length && outbox[0].at <= T) {
      sim.reconcile(outbox.shift().state);
      maxErr = Math.max(maxErr, Math.hypot(sim.errX, sim.errY));
    }
    const me = sim.runner;
    sim.advance(T + lead, me.alive && hover(me, 7));
    sim.decay(1000 / 120);
  }
  return { sim, server, changes, maxErr };
}

const leadFor = (rtt) => Math.min(30, Math.ceil((rtt / 2 + 40) / STEP_MS));

test("jetpack — predição: com os botões certos dos outros e atraso < lead, nenhuma correção", async (t) => {
  const mod = await loadFront("net/predict.ts");
  if (!mod) return t.skip("front fora do lugar");
  for (const rtt of [0, 80, 150]) {
    const r = race(mod.PartySim, { rttMs: rtt, lead: leadFor(rtt), oracle: true });
    assert.ok(r.changes > 20, `RTT ${rtt}: o jogador mexeu (${r.changes})`);
    assert.equal(r.sim.corrections, 0, `RTT ${rtt}: ${r.sim.corrections} correções`);
    assert.equal(r.maxErr, 0, `RTT ${rtt}: erro visual ${r.maxErr}`);
  }
});

test("jetpack — predição: fantasmas com o último botão contado, correções raras e pequenas", async (t) => {
  const mod = await loadFront("net/predict.ts");
  if (!mod) return t.skip("front fora do lugar");
  for (const rtt of [0, 80, 150]) {
    const r = race(mod.PartySim, { rttMs: rtt, lead: leadFor(rtt) });
    const states = Math.floor(r.server.ticks / 6);
    assert.ok(r.sim.corrections <= states * 0.1, `RTT ${rtt}: ${r.sim.corrections} correções em ${states} estados`);
    assert.ok(r.maxErr < 2, `RTT ${rtt}: erro visual ${r.maxErr}`);
  }
});

test("jetpack — predição: entrada que chega tarde corrige (limitado) e o erro visual fica pequeno", async (t) => {
  const mod = await loadFront("net/predict.ts");
  if (!mod) return t.skip("front fora do lugar");
  const r = race(mod.PartySim, { rttMs: 300, lead: 5, oracle: true, slots: [0] });
  assert.ok(r.sim.corrections > 0, "com atraso acima do lead há correção");
  assert.ok(r.sim.corrections <= r.changes * 4, `${r.sim.corrections} correções para ${r.changes} mudanças`);
  assert.ok(r.maxErr < 2, `erro visual ${r.maxErr}`);
});

test("jetpack — predição: cápsula que outro levou corrige o combustível", async (t) => {
  const mod = await loadFront("net/predict.ts");
  if (!mod) return t.skip("front fora do lugar");
  const seed = 5;
  const sim = new mod.PartySim(seed, [0, 1], 0);
  const server = new Back.Match(seed, [0, 1], Back.TUNING);
  server.start();
  let got = null;
  for (let k = 1; k < 4000 && !got && sim.runner.alive; k++) {
    const me = sim.runner;
    const next = sim.match.track.pickups.find((p) => !p.taken && p.kind !== "vulcan" && p.x > me.x);
    const h = hover(me, next ? next.y : 7);
    for (const e of sim.advance(k, h)) if (e.type === "pickup" && e.slot === 0 && e.kind !== "vulcan") got = e;
    server.step([sim.heldAt(k), false]);
    server.drain();
  }
  assert.ok(got, "o jogador previsto pegou uma cápsula");
  const P = sim.tick;
  sim.advance(P + 12, false);
  const fuelPredicted = sim.runner.fuel.value;
  // O servidor diz: no passo P a cápsula foi da vaga 1 (não entrou no meu tanque).
  const st = stateOf(server, [false, false], [[String(got.id), 1]], []);
  const me = [...st.runners.values()].find((r) => r.slot === 0);
  me.fuel -= got.added;
  me.fc -= got.added;
  me.got -= 1;
  sim.reconcile(st);
  assert.equal(sim.corrections, 1);
  assert.equal(sim.tick, P + 12, "re-simulou até o passo local");
  assert.ok(Math.abs(sim.runner.fuel.value - (fuelPredicted - got.added)) < 1e-9, `${sim.runner.fuel.value} × ${fuelPredicted - got.added}`);
  assert.ok(sim.match.track.pickupById(got.id).taken, "a cápsula continua fora do percurso");
});

test("jetpack — predição: morte prevista só vira 'saiu' com o estado 4 do servidor", async (t) => {
  const mod = await loadFront("net/predict.ts");
  if (!mod) return t.skip("front fora do lugar");
  const sim = new mod.PartySim(9, [0, 1], 0);
  const server = new Back.Match(9, [0, 1], Back.TUNING);
  server.start();
  const lead = 20;
  let k = 0;
  while (sim.runner.alive) {
    k++;
    sim.advance(k + lead, false);
    server.step([false, true]);
    server.drain();
  }
  assert.equal(sim.outConfirmed, false, "morreu só na predição");
  sim.reconcile(stateOf(server, [false, true], [], []));
  assert.equal(server.runners[0].alive, true);
  assert.equal(sim.outConfirmed, false, "o servidor ainda não contou");
  while (server.runners[0].alive) {
    server.step([false, true]);
    server.drain();
  }
  sim.reconcile(stateOf(server, [false, true], [], []));
  assert.equal(sim.outConfirmed, true);
});

test("jetpack — predição: fantasma não vai além de 300 ms do último estado", async (t) => {
  const mod = await loadFront("net/predict.ts");
  if (!mod) return t.skip("front fora do lugar");
  const sim = new mod.PartySim(3, [0, 1], 0);
  const server = new Back.Match(3, [0, 1], Back.TUNING);
  server.start();
  for (let k = 1; k <= 60; k++) {
    server.step([false, script(1, k)]);
    server.drain();
  }
  sim.advance(60, false);
  sim.reconcile(stateOf(server, [false, script(1, 60)], [], []));
  let at36 = null;
  for (let k = 61; k <= 60 + 120 && sim.runner.alive; k++) {
    sim.advance(k, hover(sim.runner, 7));
    if (k === 96) at36 = sim.ghostSnap(1).x;
  }
  assert.ok(sim.tick > 96 + 12, "o cliente seguiu sem estado novo");
  assert.equal(sim.ghostSnap(1).x, at36, "o fantasma parou em 36 passos (300 ms)");
  assert.ok(sim.match.runners[1].x > at36, "a sim local seguiu andando");
});

// ── Câmera do grupo (party-camera.ts) ────────────────────────────────────────

test("jetpack — câmera: em coluna o líder fica a 26 %; com 4,5 m de folga, ~57 % e a rabeira a 10 %", async (t) => {
  const mod = await loadFront("party-camera.ts");
  if (!mod) return t.skip("front fora do lugar");
  const W = 9.5;
  const col = mod.partyCameraFocus(100, 100, W);
  assert.ok(Math.abs(col.screenX - 0.26) < 1e-12);
  assert.ok(Math.abs(col.focusX - (100 + W * (0.5 - 0.26))) < 1e-9);
  const open = mod.partyCameraFocus(104.5, 100, W);
  assert.ok(Math.abs(open.screenX - 0.5737) < 0.001, String(open.screenX));
  const left = open.focusX - W / 2;
  assert.ok(Math.abs((100 - left) / W - 0.1) < 1e-9, "rabeira a 10 % da borda");
  // Mola: chega perto do alvo em ~0,5 s, sem passar muito.
  const spring = new mod.CameraSpring();
  let max = 0;
  for (let i = 0; i < 60; i++) max = Math.max(max, spring.update(open.screenX, 1 / 60));
  assert.ok(Math.abs(spring.screenX - open.screenX) < 0.01, String(spring.screenX));
  assert.ok(max < open.screenX + 0.01, "sem passar do alvo");
});
