// src/utils/meuMundoInteriorMotion.js
//
// MEU MUNDO 3D — a REGRA de deslocamento DENTRO das casas (mm3d-09).
//
// É a mesma regra do bairro (meuMundoMotion.js: aceleração, velocidades,
// raio, subpassos, colisão 2D) com DUAS coisas a mais: o ANDAR em que o
// personagem está e as ESCADAS que ligam um andar ao outro. O cliente roda a
// MESMA conta (features/meu-mundo/engine/interior-motion.ts): mexeu num lado,
// mexe no outro.
//
// ═══ ESCADA ═══
// Uma escada é um retângulo no chão que sobe na direção `dir` do andar
// `from` até o `to`. A colisão continua 2D: cada andar tem a SUA lista de
// caixas (paredes, móveis, corrimãos). Quem está no andar de baixo e entra no
// retângulo pela ponta de baixo vai subindo (a altura `y` acompanha o
// avanço); ao chegar ao alto, o andar troca. No andar de cima o retângulo é o
// vão da laje: corrimão nos lados e no pé, aberto só no alto, por onde se
// desce. Nunca há teletransporte: a troca de andar acontece onde as duas
// alturas já coincidem.

const { MOTION, resolveCircle } = require("./meuMundoMotion");

const STAIR_MARGIN = MOTION.RADIUS + 0.02;

/** Avanço (0 embaixo … 1 em cima) dentro do retângulo, ou null se fora. */
function stairProgress(st, x, z) {
  if (x < st.x0 || x > st.x1 || z < st.z0 || z > st.z1) return null;
  const len = st.dir === "+z" || st.dir === "-z" ? st.z1 - st.z0 : st.x1 - st.x0;
  const along =
    st.dir === "+z" ? z - st.z0 : st.dir === "-z" ? st.z1 - z : st.dir === "+x" ? x - st.x0 : st.x1 - x;
  const m = STAIR_MARGIN / len;
  return Math.max(0, Math.min(1, (along / len - m) / (1 - 2 * m)));
}

/** Altura do chão sob o personagem (y absoluto). */
function heightAt(body, def) {
  for (const st of def.stairs) {
    if (body.floor !== st.from && body.floor !== st.to) continue;
    const t = stairProgress(st, body.x, body.z);
    if (t === null) continue;
    return def.floors[st.from].y + t * (def.floors[st.to].y - def.floors[st.from].y);
  }
  return def.floors[body.floor].y;
}

/** Troca de andar quando o personagem chega à ponta da escada. */
function updateFloor(body, def) {
  for (const st of def.stairs) {
    const t = stairProgress(st, body.x, body.z);
    if (t === null) continue;
    if (body.floor === st.from && t >= 1) {
      body.floor = st.to;
      return;
    }
    if (body.floor === st.to && t <= 0) {
      body.floor = st.from;
      return;
    }
  }
}

/**
 * Um passo de simulação dentro da casa. `body` = { x, z, vx, vz, facing,
 * floor, y }, mutado no lugar. `def` = { floors: [{ y, boxes, bounds }],
 * stairs }. Devolve o estado de movimento (0 parado, 1 andando, 2 correndo).
 */
function stepInterior(body, intent, dt, def, speeds = { walk: MOTION.WALK_SPEED, run: MOTION.RUN_SPEED }) {
  const speedMax = intent.run ? speeds.run : speeds.walk;
  const k = 1 - Math.exp(-MOTION.ACCEL * dt);
  body.vx += (intent.x * speedMax - body.vx) * k;
  body.vz += (intent.z * speedMax - body.vz) * k;
  let speed = Math.hypot(body.vx, body.vz);
  if (speed < MOTION.STOP_EPS) {
    body.vx = 0;
    body.vz = 0;
    speed = 0;
  }
  const steps = Math.max(1, Math.ceil(dt / MOTION.SUBSTEP));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    // Cada andar tem o seu limite: no térreo a porta da rua é a borda (não se
    // sai para baixo da sacada do andar de cima).
    const fl = def.floors[body.floor];
    const b = fl.bounds;
    const boxes = fl.boxes;
    const next = resolveCircle(body.x + body.vx * h, body.z + body.vz * h, MOTION.RADIUS, boxes);
    body.x = Math.max(b.minX, Math.min(b.maxX, next.x));
    body.z = Math.max(b.minZ, Math.min(b.maxZ, next.z));
    updateFloor(body, def);
  }
  body.y = heightAt(body, def);
  if (speed > 0.25) body.facing = Math.atan2(body.vx, body.vz);
  if (speed < 0.25) return 0;
  return intent.run && speed > (speeds.walk + speeds.run) / 2 - 0.4 ? 2 : 1;
}

/** O ponto está livre neste andar (dentro dos limites e fora de caixas)? */
function isFreeSpot(def, floor, x, z, radius = MOTION.RADIUS) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const f = def.floors[floor];
  if (!f) return false;
  const b = f.bounds;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
  const r = resolveCircle(x, z, radius, f.boxes);
  return Math.hypot(r.x - x, r.z - z) < 1e-3;
}

module.exports = { stepInterior, heightAt, stairProgress, isFreeSpot, STAIR_MARGIN };
