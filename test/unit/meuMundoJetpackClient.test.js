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
