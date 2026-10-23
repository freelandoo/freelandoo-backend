// test/unit/meuMundoJetpack.test.js — MEU MUNDO 3D: jetpack (mm3d-21)
//
// O fixture de ouro foi gravado da simulação do mm3d-20, ANTES de ela ser
// separada em percurso + jogador + partida para o modo de até 4 pessoas
// (scripts/jetpack-golden.js). Enquanto ele bater, o jogo sozinho é o mesmo:
// mesmas posições, mesmo combustível, mesmos obstáculos, mesmos eventos no
// mesmo passo. A sim do front é carregada direto do .ts (test/unit/_frontTs.js);
// sem o front ao lado, a parte do front pula.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFront } = require("./_frontTs");
const { golden } = require("./_jetpackScript");
const GOLD = require("../fixtures/jetpack-golden.json");

process.removeAllListeners("warning"); // aviso de "module type" do .ts do front

test("jetpack — front: o jogo sozinho é idêntico ao ouro do mm3d-20", async (t) => {
  const world = await loadFront("sim/world.ts");
  const pilot = await loadFront("sim/autopilot.ts");
  if (!world || !pilot) return t.skip("front fora do lugar");
  const now = golden(world.World, pilot.autopilot);
  assert.deepEqual(Object.keys(now), Object.keys(GOLD));
  for (const k of Object.keys(GOLD)) assert.deepEqual(now[k], GOLD[k], k);
});

// ── Grupo (2–4) — regras do match.ts ─────────────────────────────────────────

/** Segura até a altura alvo (com a frenagem), como um jogador que só quer ficar reto. */
const hover = (r, target, tune) =>
  r.vy < 0 ? r.y - (r.vy * r.vy) / (2 * (tune.thrust - tune.gravity)) - 0.1 < target : r.y + (r.vy * r.vy) / (2 * tune.gravity) + 0.1 < target;

async function sim() {
  const m = await loadFront("sim/match.ts");
  const tr = await loadFront("sim/track.ts");
  const tu = await loadFront("sim/tuning.ts");
  const w = await loadFront("sim/world.ts");
  const ap = await loadFront("sim/autopilot.ts");
  const gen = await loadFront("sim/generator.ts");
  if (!m) return null;
  return { ...m, ...tr, ...tu, ...w, ...ap, ...gen };
}

test("jetpack — grupo: turbo de um puxa a câmera; os outros são rebocados a no máx. 4,5 m e a coluna se refaz", async (t) => {
  const S = await sim();
  if (!S) return t.skip("front fora do lugar");
  const tune = { ...S.TUNING, firstObstacleX: 1e6 }; // sem obstáculos: só a regra do reboque
  const m = new S.Match(5, [0, 1, 2, 3], tune);
  m.start();
  let towedSeen = false;
  let graceSeen = false;
  let powerEnd = 0;
  let regroupedAt = 0;
  for (let i = 0; i < 120 * 20; i++) {
    if (i === 10) m.runners[0].powerUntil = m.track.t + tune.powerTime;
    for (const s of [0, 1, 2, 3]) m.runners[s].fuel.setValue(tune.fuel.max); // sem pista, sem cápsula: só o reboque importa aqui
    const held = [0, 1, 2, 3].map((s) => hover(m.runners[s], S.PARTY.startY[s], tune));
    m.step(held);
    const lead = m.leaderX();
    for (const s of [0, 1, 2, 3]) {
      const r = m.runners[s];
      assert.ok(r.alive, `vaga ${s} viva`);
      assert.ok(lead - r.x <= S.PARTY.maxSpread + 1e-9, `vaga ${s} a ${lead - r.x} m do líder`);
      if (r.towed) towedSeen = true;
      if (r.graceUntil > 0) graceSeen = true;
    }
    if (!powerEnd && i > 10 && !m.runners[0].poweredAt(m.track.t)) powerEnd = m.track.t;
    if (powerEnd && !regroupedAt && lead - m.tailX() < 0.05) regroupedAt = m.track.t;
  }
  assert.ok(towedSeen, "alguém foi rebocado");
  assert.ok(graceSeen, "soltar do reboque dá imunidade");
  assert.ok(regroupedAt && regroupedAt - powerEnd < 8, `coluna refeita ${regroupedAt - powerEnd} s depois do turbo`);
});

test("jetpack — grupo: rebocado não morre em obstáculo; quem tem turbo quebra as peças", async (t) => {
  const S = await sim();
  if (!S) return t.skip("front fora do lugar");
  const tune = S.TUNING;
  const m = new S.Match(42, [0, 1, 2], tune);
  m.start();
  m.runners[0].powerUntil = 1e9; // turbo sem fim para a vaga 0
  const deaths = [];
  let smashes = 0;
  for (let i = 0; i < 120 * 8; i++) {
    m.step([0, 1, 2].map((s) => hover(m.runners[s], tune.startY, tune)));
    for (const e of m.drain()) {
      if (e.type === "dead") deaths.push([e.slot, e.cause, m.runners[e.slot].towed]);
      if (e.type === "smash") smashes++;
    }
  }
  assert.ok(smashes > 0, "a vaga com turbo quebrou peças");
  assert.deepEqual(deaths.filter(([, cause, towed]) => cause === "obstacle" && towed), [], "ninguém rebocado morreu em obstáculo");
  assert.ok(m.runners[1].towed && m.runners[2].towed, "atrás do turbo, os outros seguem rebocados");
});

test("jetpack — grupo: cápsula disputada vai para um só (maior x; empate → menor vaga)", async (t) => {
  const S = await sim();
  if (!S) return t.skip("front fora do lugar");
  const tune = { ...S.TUNING, firstObstacleX: 1e6 };
  const m = new S.Match(3, [1, 2], tune);
  m.start();
  m.track.pickups.length = 0;
  for (const s of [1, 2]) Object.assign(m.runners[s], { y: 6, vy: 0 });
  m.track.pickups.push({ id: 9999, x: m.runners[1].x + 0.6, y: 6, kind: "small", taken: false });
  m.step([false, false, false, false]);
  const got = m.drain().filter((e) => e.type === "pickup");
  assert.deepEqual(got.map((e) => e.slot), [1], "só a vaga 1 leva");
  assert.equal(m.track.pickups[0].taken, true);
  assert.equal(m.runners[2].pickupsTaken, 0);
});

test("jetpack — grupo: peça quebrada some para todos", async (t) => {
  const S = await sim();
  if (!S) return t.skip("front fora do lugar");
  const m = new S.Match(42, [0, 1], S.TUNING);
  const o = m.track.obstacles[0];
  const r = m.runners[1];
  Object.assign(r, { x: o.x + o.w / 2, y: S.TUNING.floor + 1.2 }); // dentro da peça de baixo
  assert.equal(r.collide(m.track, 0), "obstacle");
  m.track.breakPiece(o.id, 0);
  assert.equal(r.collide(m.track, 0), null);
});

test("jetpack — Track.rebuild com os turbos pegos = o percurso da partida", async (t) => {
  const S = await sim();
  if (!S) return t.skip("front fora do lugar");
  const m = new S.Match(42, [0], S.TUNING, { startOnHold: true });
  const w = new S.World(42); // o piloto lê a API do World; espelhamos no Match
  let vul = 0;
  for (let i = 0; i < 14400 && w.alive; i++) {
    const h = S.autopilot(w);
    w.step(h);
    m.step([h]);
  }
  vul = m.track.vulcans.length;
  assert.ok(vul >= 3, `pegou ${vul} turbos`);
  const live = m.track;
  const re = S.Track.rebuild(42, live.vulcans, m.leaderX() + S.TUNING.lookahead);
  const sig = (o) => [o.id, o.kind, o.x, o.w, o.pathY, o.gap, o.amp].join(",");
  const byId = new Map(re.obstacles.map((o) => [o.id, sig(o)]));
  for (const o of live.obstacles) assert.equal(byId.get(o.id), sig(o), `obstáculo ${o.id}`);
  const pk = new Map(re.pickups.map((p) => [p.id, [p.kind, p.x, p.y].join(",")]));
  for (const p of live.pickups) assert.equal(pk.get(p.id), [p.kind, p.x, p.y].join(","), `cápsula ${p.id}`);
});

test("jetpack — colocação: morreu depois = melhor; mesmo passo → maior distância; empate = mesma posição", async (t) => {
  const S = await sim();
  if (!S) return t.skip("front fora do lugar");
  const m = new S.Match(1, [0, 1, 2, 3], S.TUNING);
  const set = (s, x, deathTick) => Object.assign(m.runners[s], { x, deathTick, state: "dead" });
  set(0, 50, 900);
  set(1, 80, 1200);
  set(2, 60, 900);
  set(3, 60, 900);
  assert.deepEqual(
    m.placements().map((p) => [p.slot, p.place]),
    [[1, 1], [2, 2], [3, 2], [0, 4]],
  );
});

// ── Servidor: a mesma sim, gerada do TS (scripts/build-jetpack-sim.js) ────────

const back = require("../../src/utils/meuMundoJetpack");

test("jetpack — servidor: src/utils/meuMundoJetpack.js está em dia com a sim do front", (t) => {
  const { build, SIM } = require("../../scripts/build-jetpack-sim");
  if (!require("fs").existsSync(SIM)) return t.skip("front fora do lugar");
  const cur = require("fs").readFileSync(require.resolve("../../src/utils/meuMundoJetpack"), "utf8");
  // CRLF do checkout no Windows não conta como diferença.
  assert.equal(cur.replace(/\r\n/g, "\n"), build(), "rode: node scripts/build-jetpack-sim.js");
});

test("jetpack — servidor: o jogo sozinho é idêntico ao ouro do mm3d-20", () => {
  const now = golden(back.World, back.autopilot);
  for (const k of Object.keys(GOLD)) assert.deepEqual(now[k], GOLD[k], k);
});

test("jetpack — servidor × navegador: partida de 4 passo a passo, igualdade exata", async (t) => {
  const S = await sim();
  if (!S) return t.skip("front fora do lugar");
  const run = (M, tune) => {
    const m = new M.Match(1234, [0, 1, 2, 3], tune);
    m.start();
    const out = [];
    for (let i = 0; i < 120 * 30 && m.aliveCount(); i++) {
      if (i === 600) m.runners[2].powerUntil = m.track.t + tune.powerTime;
      m.step([0, 1, 2, 3].map((s) => (i + s * 37) % (90 + s * 11) < 48 + s * 3));
      out.push(
        JSON.stringify([
          m.ticks,
          [0, 1, 2, 3].map((s) => m.runners[s].snapshot()),
          m.track.obstacles.map((o) => [o.id, o.x, o.broken]),
          m.track.pickups.map((p) => [p.id, p.taken]),
          m.drain(),
        ]),
      );
    }
    return out;
  };
  const a = run(S, S.TUNING);
  const b = run(back, back.TUNING);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert.equal(b[i], a[i], `passo ${i}`);
  assert.deepEqual(back.TUNING, S.TUNING);
  assert.deepEqual(back.PARTY, S.PARTY);
  assert.equal(back.VULCAN_EVERY, S.VULCAN_EVERY);
});
