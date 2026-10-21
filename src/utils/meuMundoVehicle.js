// src/utils/meuMundoVehicle.js
//
// MEU MUNDO 3D — física do carro (mm3d-12). Substitui a regra de mm3d-11, em
// que o carro era um "boneco rápido" (virava para onde a velocidade apontava,
// sem rodas e sem inércia lateral).
//
// ═══ O MODELO ═══
// Corpo rígido no plano (o bairro é PLANO — não há rampa, degrau nem chão a
// desníveis; a colisão do jogo inteiro é 2D). Quatro pontos de contato, um
// por roda. A cada passo:
//   1. velocidade de cada ponto de contato = v + ω × r (no referencial do
//      carro, girado pelo esterçamento nas rodas da frente);
//   2. força lateral do pneu = −rigidez × velocidade lateral do ponto;
//      força longitudinal = tração (só traseira), freio, freio de mão;
//   3. círculo de atrito: |F| ≤ μ × carga da roda (a carga muda com a
//      transferência de peso da aceleração/curva do passo anterior);
//   4. soma das forças e torques → integra v, ω, posição e rumo.
// Daí saem, sem regra especial: carro parado NÃO gira (sem velocidade nos
// contatos não há força lateral), sub/sobre-esterço, derrapagem com freio de
// mão (aderência traseira cai), contraesterço funcionando.
//
// "Suspensão": com chão plano as quatro rodas estão SEMPRE em contato; a
// carga de cada roda (transferência de peso) é o que a suspensão faz aqui. O
// balanço visual da carroceria é desenhado no cliente a partir de ax/ay.
// Não há ar para "dirigir no ar".
//
// ═══ DETERMINISMO E REDE ═══
// Passo FIXO de 1/60 s com acumulador e teto de subpassos (quem volta de aba
// suspensa não simula o tempo perdido). O servidor (sala do bairro) é a
// autoridade: roda ESTE arquivo com a entrada que o motorista manda. O
// cliente roda o espelho exato (features/meu-mundo/engine/vehicle.ts) para
// responder na hora e converge suavemente para o estado do servidor — é
// previsão com reconciliação suave, não rollback. Mexeu num lado, mexe no
// outro: o teste test/unit/meuMundoVehicle.test.js confere as constantes.

const { resolveCircle } = require("./meuMundoMotion");

/** Passo fixo da simulação (s) e teto de passos por chamada. */
const STEP = 1 / 60;
const MAX_STEPS = 8;
const G = 9.81;

/**
 * Parâmetros de dirigibilidade. Os de ajuste (painel do administrador) têm
 * faixa em TUNING_RANGES; o resto é geometria do carro e não se mexe.
 */
const VEHICLE = Object.freeze({
  MASS: 1150, // kg
  INERTIA: 1750, // kg·m² (momento de inércia em guinada)
  CG_FRONT: 1.22, // m do centro de massa ao eixo dianteiro
  CG_REAR: 1.38, // m ao eixo traseiro (entre-eixos 2,6)
  TRACK: 1.72, // m entre rodas (centro dos pneus)
  CG_HEIGHT: 0.42, // m — só para a transferência de peso
  WHEEL_RADIUS: 0.42, // m (o modelo do Blender tem o mesmo raio)
  ENGINE: 6200, // N de tração máxima parada
  MAX_SPEED: 19, // m/s (~68 km/h) — rua de bairro
  REVERSE_FORCE: 3000, // N
  REVERSE_SPEED: 5, // m/s
  BRAKE: 11000, // N (total, nas quatro rodas)
  ROLL: 140, // N de resistência ao rolamento
  ROLL_LIN: 35, // N por m/s
  DRAG: 0.42, // N por (m/s)²
  STIFF: 13000, // N por m/s de deslizamento lateral, por roda
  GRIP_FRONT: 1.08, // μ dianteiro
  GRIP_REAR: 1.3, // μ traseiro (maior: o carro sai de frente, não roda)
  HB_GRIP: 0.32, // fração da aderência traseira com freio de mão inteiro
  HB_BRAKE: 2600, // N de freio nas traseiras com freio de mão
  HB_RISE: 3, // 1/s — a aderência cai progressivamente
  HB_FALL: 2.2, // 1/s — e volta suavemente ao soltar
  STEER_MAX: 0.6, // rad de esterçamento parado/devagar
  STEER_FALL: 6, // m/s: em STEER_FALL o ângulo máximo cai à metade
  STEER_RATE: 2.6, // rad/s girando o volante
  STEER_RETURN: 3.6, // rad/s voltando ao centro
  REVERSE_DELAY: 0.35, // s parado segurando o freio até engatar a ré
  THROTTLE_RISE: 3, // 1/s — acelerador progressivo
  THROTTLE_FALL: 7,
  ASSIST: 0.5, // 0..1 assistência arcade (contraesterço + amortecimento)
  CS_GAIN: 0.8, // contraesterço automático por rad de deslizamento
  YAW_DAMP: 3, // amortecimento de guinada quando derrapa (× assist)
  // Colisão: três círculos ao longo do carro (frente, meio, traseira).
  COL_OFFSET: 1.2,
  COL_RADIUS: 0.98,
  RESTITUTION: 0.18,
  COL_FRICTION: 0.25,
  HX: 1.0, // meia-largura (caixa que bloqueia os outros)
  HZ: 2.12, // meio-comprimento
});

/** Faixas aceitas pelo painel de ajuste (o servidor fixa o que vier fora). */
const TUNING_RANGES = Object.freeze({
  ENGINE: [2500, 12000],
  MAX_SPEED: [8, 30],
  REVERSE_SPEED: [2, 8],
  BRAKE: [4000, 20000],
  GRIP_FRONT: [0.6, 2],
  GRIP_REAR: [0.6, 2],
  HB_GRIP: [0.15, 0.9],
  STEER_MAX: [0.3, 0.8],
  STEER_FALL: [3, 20],
  STEER_RATE: [1, 6],
  ASSIST: [0, 1],
  STIFF: [5000, 25000],
});

/**
 * Modalidades (mm3d-14). A mobilidade é a MESMA do carro (pedido do Alex:
 * "todos é igual o carro a mobilidade deles"); muda só a FORMA que bate —
 * três círculos menores ao longo do veículo — e a caixa que bloqueia os outros.
 */
const KINDS = Object.freeze({
  car: Object.freeze({}),
  bike: Object.freeze({ COL_OFFSET: 0.42, COL_RADIUS: 0.36, HX: 0.32, HZ: 0.72 }),
  skate: Object.freeze({ COL_OFFSET: 0.2, COL_RADIUS: 0.34, HX: 0.3, HZ: 0.42 }),
  skates: Object.freeze({ COL_OFFSET: 0.0, COL_RADIUS: 0.36, HX: 0.3, HZ: 0.3 }),
});

/** Junta ajustes (já validados) aos parâmetros padrão. */
function tuned(overrides) {
  if (!overrides) return VEHICLE;
  return Object.freeze({ ...VEHICLE, ...overrides });
}

/** Parâmetros de uma modalidade com os ajustes do painel por cima. */
function paramsFor(kind, overrides) {
  const k = KINDS[kind] || KINDS.car;
  if (!overrides && k === KINDS.car) return VEHICLE;
  return Object.freeze({ ...VEHICLE, ...k, ...(overrides || {}) });
}

/** Valida um pacote de ajustes vindo da rede. Fora da faixa é fixado na borda. */
function sanitizeTuning(m) {
  if (!m || typeof m !== "object") return null;
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(TUNING_RANGES)) {
    if (!(k in m)) continue;
    const v = Number(m[k]);
    if (!Number.isFinite(v)) continue;
    out[k] = Math.max(lo, Math.min(hi, v));
  }
  return out;
}

/** Entrada de direção vinda da rede: acelerador, freio/ré, volante, freio de mão. */
function sanitizeDrive(m) {
  if (!m || typeof m !== "object") return null;
  const num = (v, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0;
  };
  return { t: num(m.t, 0, 1), b: num(m.b, 0, 1), s: num(m.s, -1, 1), h: m.h === true || m.h === 1 };
}

const IDLE = Object.freeze({ t: 0, b: 0, s: 0, h: false });

/** Estado novo de um carro parado. */
function createVehicle(x, z, facing) {
  return {
    x,
    z,
    yaw: facing,
    vx: 0,
    vz: 0,
    w: 0, // rad/s, positivo = virando à direita
    steer: 0, // rad nas rodas da frente, positivo = à direita
    thr: 0, // acelerador suavizado
    hb: 0, // freio de mão suavizado (0..1)
    ax: 0, // aceleração local para frente (m/s²)
    ay: 0, // aceleração local para a direita
    u: 0, // velocidade longitudinal (m/s, negativa = ré)
    slip: 0, // 0..1: quanto os pneus traseiros estão no limite
    beta: 0, // ângulo de deslizamento da carroceria (rad)
    gear: 0, // 1 frente, -1 ré, 0 parado
    stopT: 0, // tempo parado segurando o freio (engate da ré)
    acc: 0, // acumulador do passo fixo
  };
}

function approach(cur, target, rate) {
  if (cur < target) return Math.min(target, cur + rate);
  return Math.max(target, cur - rate);
}

const tmpTire = { flong: 0, flat: 0, slide: 0 };

/** Força de um pneu no referencial da roda, limitada pelo círculo de atrito. */
function tire(vlong, vlat, drive, brake, grip, stiff, load, kStop) {
  let flat = -stiff * vlat;
  // Freio: oposto ao rolamento, sem passar do que para a roda neste passo.
  let flong = drive;
  if (brake > 0) {
    const stop = Math.min(brake, kStop * Math.abs(vlong));
    flong -= Math.sign(vlong) * stop;
  }
  // Também a força lateral não pode inverter o deslizamento em um passo.
  const latCap = kStop * Math.abs(vlat);
  if (Math.abs(flat) > latCap) flat = Math.sign(flat) * latCap;
  const max = grip * load;
  const mag = Math.hypot(flong, flat);
  let slide = 0;
  if (mag > max && mag > 1e-6) {
    const k = max / mag;
    flong *= k;
    flat *= k;
    slide = 1 - k;
  }
  tmpTire.flong = flong;
  tmpTire.flat = flat;
  tmpTire.slide = slide;
  return tmpTire;
}

/** Um passo fixo (STEP) da dinâmica, sem colisão. */
function integrate(c, input, P) {
  const dt = STEP;
  const fx = Math.sin(c.yaw);
  const fz = Math.cos(c.yaw);
  const rx = fz;
  const rz = -fx;
  const vu = c.vx * fx + c.vz * fz; // para frente
  const vs = c.vx * rx + c.vz * rz; // para a direita
  const speed = Math.hypot(c.vx, c.vz);

  // ── Câmbio (frente × ré), acelerador e freio ──
  let drive = 0;
  let brake = 0;
  c.thr = approach(c.thr, input.t, (input.t > c.thr ? P.THROTTLE_RISE : P.THROTTLE_FALL) * dt);
  if (input.t > 0) {
    if (vu < -0.5) brake = input.t * P.BRAKE; // acelerador andando de ré = freia
    else {
      const k = Math.max(0, 1 - (Math.max(0, vu) / P.MAX_SPEED) ** 2);
      drive = c.thr * P.ENGINE * k;
    }
  }
  if (input.b > 0) {
    if (vu > 0.05) brake = Math.max(brake, input.b * P.BRAKE);
    else if (input.t === 0 && c.stopT >= P.REVERSE_DELAY && vu > -P.REVERSE_SPEED) {
      const k = 1 - Math.max(0, -vu) / P.REVERSE_SPEED;
      drive = -input.b * P.REVERSE_FORCE * k;
    }
  }
  // Ré só depois de PARAR segurando o freio (não engata no meio da frenagem).
  if (input.b > 0 && input.t === 0 && Math.abs(vu) < 0.3) c.stopT += dt;
  else if (input.b === 0 || vu > 0.6) c.stopT = 0;
  c.gear = vu > 0.3 ? 1 : vu < -0.3 ? -1 : drive < 0 ? -1 : drive > 0 ? 1 : 0;

  // ── Freio de mão (progressivo) ──
  c.hb = approach(c.hb, input.h ? 1 : 0, (input.h ? P.HB_RISE : P.HB_FALL) * dt);

  // ── Volante: ângulo máximo cai com a velocidade, volta ao centro devagar ──
  const maxSteer = P.STEER_MAX / (1 + Math.max(0, Math.abs(vu)) / P.STEER_FALL);
  let target = input.s * maxSteer;
  // Assistência arcade: esterça a favor do deslizamento (contraesterço).
  const beta = speed > 3 ? Math.atan2(vs, Math.abs(vu)) : 0;
  if (speed > 3 && vu > 0) target += P.ASSIST * P.CS_GAIN * beta;
  target = Math.max(-P.STEER_MAX, Math.min(P.STEER_MAX, target));
  const rate = input.s === 0 ? P.STEER_RETURN : P.STEER_RATE;
  c.steer = approach(c.steer, target, rate * dt);

  // ── Cargas (transferência de peso do passo anterior) ──
  const L = P.CG_FRONT + P.CG_REAR;
  const mg = P.MASS * G;
  const half = P.TRACK / 2;
  const staticF = (mg * P.CG_REAR) / L / 2;
  const staticR = (mg * P.CG_FRONT) / L / 2;
  const dLong = (P.MASS * c.ax * P.CG_HEIGHT) / L / 2;
  const dLat = (P.MASS * c.ay * P.CG_HEIGHT) / P.TRACK / 2;
  const kStop = (P.MASS / 4 / dt) * 0.5;
  const rearGrip = P.GRIP_REAR * (1 - c.hb * (1 - P.HB_GRIP));

  // Rodas: [lado (−1 esq, +1 dir), posição longitudinal, frente?]
  let Fs = 0;
  let Fu = 0;
  let tq = 0;
  let rearSlide = 0;
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const side = i % 2 === 0 ? -1 : 1;
    const ps = side * half;
    const pu = front ? P.CG_FRONT : -P.CG_REAR;
    const load = Math.max(0.15 * (front ? staticF : staticR), (front ? staticF : staticR) - (front ? dLong : -dLong) - side * dLat);
    const d = front ? c.steer : 0;
    const sd = Math.sin(d);
    const cd = Math.cos(d);
    const ws = vs + c.w * pu;
    const wu = vu - c.w * ps;
    const vlong = ws * sd + wu * cd;
    const vlat = ws * cd - wu * sd;
    const wDrive = front ? 0 : drive / 2;
    let wBrake = brake / 4;
    if (!front) wBrake += (c.hb * P.HB_BRAKE) / 2;
    // Resistência ao rolamento entra como freio leve (não empurra parado).
    wBrake += (P.ROLL + P.ROLL_LIN * Math.abs(vlong)) / 4;
    const tr = tire(vlong, vlat, wDrive, wBrake, front ? P.GRIP_FRONT : rearGrip, P.STIFF, load, kStop);
    if (!front) rearSlide = Math.max(rearSlide, tr.slide);
    const fs = tr.flong * sd + tr.flat * cd;
    const fu = tr.flong * cd - tr.flat * sd;
    Fs += fs;
    Fu += fu;
    tq += pu * fs - ps * fu;
  }
  // Arrasto do ar, oposto à velocidade.
  Fu -= P.DRAG * vu * Math.abs(vu);

  // Assistência: amortece a guinada enquanto a traseira escapa.
  // Acima de ~35° a assistência segura com mais força (não deixa rodar).
  if (Math.abs(beta) > 0.12) {
    const k = Math.min(1, Math.abs(beta) * 2) + Math.max(0, Math.abs(beta) - 0.6) * 4;
    tq -= P.ASSIST * P.YAW_DAMP * P.INERTIA * c.w * k;
  }

  const au = Fu / P.MASS;
  const as = Fs / P.MASS;
  c.vx += (au * fx + as * rx) * dt;
  c.vz += (au * fz + as * rz) * dt;
  c.w += (tq / P.INERTIA) * dt;
  c.yaw += c.w * dt;
  if (c.yaw > Math.PI) c.yaw -= Math.PI * 2;
  else if (c.yaw < -Math.PI) c.yaw += Math.PI * 2;
  // Aceleração local suavizada (transferência de peso e balanço visual).
  const kA = 1 - Math.exp(-10 * dt);
  c.ax += (au - c.ax) * kA;
  c.ay += (as - c.ay) * kA;

  // Parado e sem comando: assenta (sem tremer).
  if (input.t === 0 && input.b === 0 && Math.hypot(c.vx, c.vz) < 0.06 && Math.abs(c.w) < 0.05) {
    c.vx = 0;
    c.vz = 0;
    c.w = 0;
  }
  c.slip = rearSlide;
  c.beta = beta;
}

/** Empurra o carro para fora dos obstáculos e aplica o impulso do choque. */
function collide(c, boxes, limit, P) {
  for (let iter = 0; iter < 2; iter++) {
    let hit = false;
    const fx = Math.sin(c.yaw);
    const fz = Math.cos(c.yaw);
    const rx = fz;
    const rz = -fx;
    for (const off of [P.COL_OFFSET, -P.COL_OFFSET, 0]) {
      const cx = c.x + fx * off;
      const cz = c.z + fz * off;
      const p = resolveCircle(cx, cz, P.COL_RADIUS, boxes, 1);
      let nx = p.x - cx;
      let nz = p.z - cz;
      const dist = Math.hypot(nx, nz);
      if (dist < 1e-6) continue;
      hit = true;
      c.x += nx;
      c.z += nz;
      nx /= dist;
      nz /= dist;
      // Ponto de contato relativo ao centro de massa.
      const ox = fx * off - nx * P.COL_RADIUS;
      const oz = fz * off - nz * P.COL_RADIUS;
      const ps = ox * rx + oz * rz;
      const pu = ox * fx + oz * fz;
      // Velocidade do ponto: v + ω × r (no referencial local).
      const pvx = c.vx + c.w * (pu * rx - ps * fx);
      const pvz = c.vz + c.w * (pu * rz - ps * fz);
      const vn = pvx * nx + pvz * nz;
      if (vn >= 0) continue;
      const ns = nx * rx + nz * rz;
      const nu = nx * fx + nz * fz;
      const tn = pu * ns - ps * nu;
      const j = (-(1 + P.RESTITUTION) * vn) / (1 / P.MASS + (tn * tn) / P.INERTIA);
      c.vx += (j * nx) / P.MASS;
      c.vz += (j * nz) / P.MASS;
      c.w += (j * tn) / P.INERTIA;
      // Atrito do raspão (tangencial), limitado pelo choque.
      const tx = -nz;
      const tz = nx;
      const vt = pvx * tx + pvz * tz;
      const ts = tx * rx + tz * rz;
      const tu = tx * fx + tz * fz;
      const tt = pu * ts - ps * tu;
      let jt = -vt / (1 / P.MASS + (tt * tt) / P.INERTIA);
      const cap = P.COL_FRICTION * j;
      jt = Math.max(-cap, Math.min(cap, jt));
      c.vx += (jt * tx) / P.MASS;
      c.vz += (jt * tz) / P.MASS;
      c.w += (jt * tt) / P.INERTIA;
    }
    if (!hit) break;
  }
  // Limite do mundo: segura e zera a velocidade para fora.
  if (c.x > limit || c.x < -limit) {
    c.x = Math.max(-limit, Math.min(limit, c.x));
    c.vx = 0;
  }
  if (c.z > limit || c.z < -limit) {
    c.z = Math.max(-limit, Math.min(limit, c.z));
    c.vz = 0;
  }
}

/** Um passo fixo completo (dinâmica + colisão). */
function stepVehicle(c, input, boxes, limit, P = VEHICLE) {
  integrate(c, input || IDLE, P);
  c.x += c.vx * STEP;
  c.z += c.vz * STEP;
  collide(c, boxes, limit, P);
  c.u = c.vx * Math.sin(c.yaw) + c.vz * Math.cos(c.yaw);
}

/**
 * Avança `dt` segundos em passos fixos. Devolve quantos passos rodou. O que
 * passar de MAX_STEPS é descartado (aba que volta não "recupera" o tempo).
 */
function advanceVehicle(c, input, dt, boxes, limit, P = VEHICLE) {
  c.acc = Math.min(c.acc + Math.max(0, dt), STEP * MAX_STEPS);
  let n = 0;
  while (c.acc >= STEP) {
    stepVehicle(c, input, boxes, limit, P);
    c.acc -= STEP;
    n++;
  }
  return n;
}

/** Caixa do carro (mesmo formato dos obstáculos do bairro). */
function vehicleBox(x, z, facing, P = VEHICLE) {
  return { x, z, hx: P.HX, hz: P.HZ, rot: facing, h: 1.3 };
}

module.exports = {
  STEP,
  MAX_STEPS,
  VEHICLE,
  KINDS,
  TUNING_RANGES,
  IDLE,
  tuned,
  paramsFor,
  sanitizeTuning,
  sanitizeDrive,
  createVehicle,
  stepVehicle,
  advanceVehicle,
  vehicleBox,
};
