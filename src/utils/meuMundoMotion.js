// src/utils/meuMundoMotion.js
//
// MEU MUNDO 3D — a REGRA de deslocamento, usada pela sala multiplayer para
// validar e aplicar o movimento. O cliente roda a MESMA regra na predição
// local (features/meu-mundo/engine/motion.ts): mexeu num lado, mexe no outro —
// as constantes são conferidas pelo teste test/unit/meuMundoMotion.test.js
// contra o arquivo do frontend quando ele está ao lado.
//
// O cliente manda só INTENÇÃO (direção no mundo, módulo até 1, e se quer
// correr). Velocidade, colisão e limites são decididos aqui; não existe
// mensagem que diga "estou em x,z".
//
// Nesta etapa os quatro tipos físicos usam exatamente as mesmas regras.

const MOTION = Object.freeze({
  WALK_SPEED: 1.9, // m/s — a caminhada do Mixamo anda 1,27 m/s a 1×
  RUN_SPEED: 3.5, // m/s — corrida lenta (Slow Run anda 2,22 m/s a 1×)
  ACCEL: 14, // suavização da velocidade (1/s), independente do quadro
  RADIUS: 0.42,
  SUBSTEP: 0.025, // s — não atravessa a cerca viva fina (0,3 m)
  STOP_EPS: 0.02,
  // mm3d-13: abaixo deste ritmo (exausto) não se corre — "correr" anda.
  PACE_RUN_MIN: 0.6,
});

/**
 * Velocidades a pé pelo RITMO do corpo (mm3d-13, meuMundoLife.pace): 1 =
 * normal, 0,7 = cansado, 0,42 = exausto. Espelho: paceSpeeds em
 * features/meu-mundo/engine/motion.ts.
 */
function paceSpeeds(pace = 1) {
  const p = Number.isFinite(pace) && pace > 0 ? Math.min(1, pace) : 1;
  const walk = MOTION.WALK_SPEED * p;
  return { walk, run: p >= MOTION.PACE_RUN_MIN ? MOTION.RUN_SPEED * p : walk };
}

function toLocal(b, px, pz) {
  const dx = px - b.x;
  const dz = pz - b.z;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

function rotY(x, z, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: x * c + z * s, z: -x * s + z * c };
}

/** Empurra o círculo para fora dos obstáculos (mesma conta do cliente). */
function resolveCircle(px, pz, radius, boxes, passes = 2) {
  let x = px;
  let z = pz;
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (const b of boxes) {
      const reach = Math.max(b.hx, b.hz) * 1.42 + radius;
      if (Math.abs(x - b.x) > reach || Math.abs(z - b.z) > reach) continue;
      const l = toLocal(b, x, z);
      const cx = Math.max(-b.hx, Math.min(b.hx, l.x));
      const cz = Math.max(-b.hz, Math.min(b.hz, l.z));
      let dx = l.x - cx;
      let dz = l.z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist >= radius) continue;
      let push;
      if (dist > 1e-6) {
        push = radius - dist;
        dx /= dist;
        dz /= dist;
      } else {
        const ox = b.hx - Math.abs(l.x);
        const oz = b.hz - Math.abs(l.z);
        if (ox < oz) {
          dx = Math.sign(l.x) || 1;
          dz = 0;
          push = ox + radius;
        } else {
          dx = 0;
          dz = Math.sign(l.z) || 1;
          push = oz + radius;
        }
      }
      const w = rotY(dx * push, dz * push, b.rot);
      x += w.x;
      z += w.z;
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}

/** Normaliza uma intenção vinda da rede. Devolve null se for lixo. */
function sanitizeIntent(m) {
  if (!m || typeof m !== "object") return null;
  let x = Number(m.x);
  let z = Number(m.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const len = Math.hypot(x, z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  if (len < 0.05) {
    x = 0;
    z = 0;
  }
  return { x, z, run: m.r === true || m.r === 1 };
}

/**
 * Um passo de simulação. `body` = { x, z, vx, vz, facing }, mutado no lugar.
 * Devolve o estado de movimento para a animação: 0 parado, 1 andando, 2 correndo.
 * `profile` (opcional) troca velocidades, aceleração e raio — é como o carro
 * (desde o mm3d-12 o carro tem física própria, meuMundoVehicle.js). Sem ele, a pé.
 */
function step(body, intent, dt, boxes, limit, profile = null) {
  const walk = profile ? profile.walk : MOTION.WALK_SPEED;
  const run = profile ? profile.run : MOTION.RUN_SPEED;
  const radius = profile ? profile.radius : MOTION.RADIUS;
  const speedMax = intent.run ? run : walk;
  const k = 1 - Math.exp(-(profile ? profile.accel : MOTION.ACCEL) * dt);
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
    const next = resolveCircle(body.x + body.vx * h, body.z + body.vz * h, radius, boxes);
    body.x = Math.max(-limit, Math.min(limit, next.x));
    body.z = Math.max(-limit, Math.min(limit, next.z));
  }
  if (speed > 0.25) body.facing = Math.atan2(body.vx, body.vz);
  if (speed < 0.25) return 0;
  return intent.run && run > walk && speed > (walk + run) / 2 - 0.4 ? 2 : 1;
}

// ═══ FÔLEGO DE CORRIDA (mm3d-28) ═══ — a sala gasta o fôlego enquanto a
// pessoa corre DE VERDADE (pediu corrida e está se movendo) e devolve quando
// anda ou para. Vazio, ela só anda até recuperar RECOVER_AT do fôlego. Não há
// tranco: a aceleração de `step` leva da corrida à caminhada aos poucos. Os
// segundos vêm da vida (meuMundoLife.js `stamina`: debilitado corre menos e
// recupera mais devagar). Só a sala calcula; o cliente lê `wd` do estado e
// não prevê corrida enquanto ele estiver ligado (nada de física em dobro).
const STAMINA = Object.freeze({ RECOVER_AT: 0.3, DEFAULT: Object.freeze({ maxS: 45, refillS: 20 }) });

function freshStamina(cfg = STAMINA.DEFAULT) {
  return { left: cfg.maxS, maxS: cfg.maxS, refillS: cfg.refillS, winded: false };
}

/** A vida mudou o fôlego: mantém a fração cheia. */
function setStamina(st, cfg) {
  if (!cfg || !(cfg.maxS > 0) || !(cfg.refillS > 0)) return;
  const frac = st.maxS > 0 ? st.left / st.maxS : 1;
  st.maxS = cfg.maxS;
  st.refillS = cfg.refillS;
  st.left = Math.min(st.maxS, frac * st.maxS);
}

/** Avança o fôlego e devolve a intenção valendo (sem corrida quando sem fôlego). */
function staminaIntent(st, intent, dt) {
  const moving = intent.x !== 0 || intent.z !== 0;
  if (intent.run && moving && !st.winded) {
    st.left = Math.max(0, st.left - dt);
    if (st.left <= 0) st.winded = true;
    return intent;
  }
  st.left = Math.min(st.maxS, st.left + dt * (st.maxS / st.refillS));
  if (st.winded && st.left >= STAMINA.RECOVER_AT * st.maxS) st.winded = false;
  return intent.run ? { x: intent.x, z: intent.z, run: false } : intent;
}

module.exports = { MOTION, STAMINA, resolveCircle, sanitizeIntent, step, paceSpeeds, freshStamina, setStamina, staminaIntent };
