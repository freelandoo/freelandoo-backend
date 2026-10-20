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
});

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
 * (meuMundoCars.CAR_PROFILE) usa a MESMA regra. Sem ele, a pé.
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
  return intent.run && speed > (walk + run) / 2 - 0.4 ? 2 : 1;
}

module.exports = { MOTION, resolveCircle, sanitizeIntent, step };
