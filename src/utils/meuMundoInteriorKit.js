// src/utils/meuMundoInteriorKit.js
//
// MEU MUNDO 3D — as PEÇAS dos interiores (mm3d-09) e o montador que
// transforma uma planta em definição completa: paredes, aberturas, janelas,
// pisos com o vão da escada, colisores, assentos e limites.
//
// As plantas dos nove níveis moram em meuMundoInteriors.js e só descrevem
// CÔMODOS (retângulos), ABERTURAS (portas e passagens), ESCADAS e MÓVEIS. As
// paredes saem dos cômodos: borda sem vizinho = parede externa (ou guarda-
// corpo, se o cômodo é uma sacada); borda com vizinho = parede interna, a não
// ser que o par esteja marcado como integrado (sala e cozinha juntas, por
// exemplo). Assim nenhum nível tem uma segunda cópia das medidas.
//
// Tudo que é COLISÃO sai daqui e vai no payload; o cliente desenha a partir
// dos mesmos números e usa exatamente estes colisores na predição local — a
// sala multiplayer da casa usa os MESMOS para validar o movimento.
//
// Coordenadas: metros, x lateral, z para os fundos (a fachada da porta é a
// borda de menor z), y para cima. A frente LOCAL de um móvel é o −Z; a
// rotação dele é em graus (0, 90, 180, 270), com a mesma convenção do
// Babylon (mão esquerda).

const { MOTION } = require("./meuMundoMotion");
const { isFreeSpot } = require("./meuMundoInteriorMotion");
const { walkInterior } = require("./meuMundoInteriorWalk");

const FLOOR_H = 2.6; // pé direito por andar, o mesmo da casa vista por fora
const WALL_T = 0.16;
const WALL_H = 2.6;
const RAIL_H = 1.0;
const SEAT_TOP = 0.38;
// Distância máxima entre o personagem e o assento para sentar (a sala da casa
// confere). O ponto de levantar fica DENTRO dela, senão levantar seria um salto.
const SEAT_REACH = 1.6; // altura do assento: medida na pose "Sit" (pipeline/build_sit.py)
// Cama (mm3d-13): é longa — deitar vale a esta distância do ponto de deitar.
const BED_REACH = 1.9;
// Altura do colchão: a pose "Lie"/"Sleep" (pipeline/build_rest.py) já traz o
// corpo nela; o servidor põe o personagem no chão, no ponto de deitar.
const BED_TOP = 0.48;
// Geladeira (mm3d-28): abre a até FRIDGE_REACH do ponto em frente à porta.
const FRIDGE_REACH = 1.4;
const EPS = 1e-6;

// ═══ MÓVEIS ═══ — w × d × h (m), frente no −Z local. `seats`: pontos onde o
// personagem fica sentado (coordenadas locais; a frente do assento é o −Z).
// `solid: false` = não colide (tapete).
const FURNITURE = Object.freeze({
  sofa2: { w: 1.7, d: 0.85, h: 0.82, seats: [[-0.42, 0.06], [0.42, 0.06]] },
  sofa3: { w: 2.3, d: 0.9, h: 0.82, seats: [[-0.74, 0.06], [0, 0.06], [0.74, 0.06]] },
  armchair: { w: 0.92, d: 0.86, h: 0.86, seats: [[0, 0.06]] },
  chair: { w: 0.5, d: 0.5, h: 0.92, seats: [[0, 0]] },
  coffee: { w: 1.0, d: 0.55, h: 0.4 },
  table2: { w: 0.8, d: 0.8, h: 0.75 },
  table4: { w: 1.3, d: 0.85, h: 0.75 },
  table6: { w: 1.9, d: 0.95, h: 0.75 },
  tv: { w: 1.4, d: 0.42, h: 0.55 },
  // `beds` (mm3d-13): onde o personagem deita — o quadril no meio do
  // colchão, a cabeça para o travesseiro (+Z local), os pés para a frente.
  bed1: { w: 1.0, d: 2.0, h: 0.5, beds: [[0, 0]] },
  bed2: { w: 1.6, d: 2.1, h: 0.5, beds: [[-0.4, 0], [0.4, 0]] },
  nightstand: { w: 0.45, d: 0.42, h: 0.5 },
  wardrobe: { w: 1.4, d: 0.6, h: 2.0 },
  desk: { w: 1.2, d: 0.6, h: 0.75 },
  shelf: { w: 1.1, d: 0.36, h: 1.8 },
  counter: { w: 2.0, d: 0.62, h: 0.9 },
  stove: { w: 0.62, d: 0.62, h: 0.9 },
  fridge: { w: 0.72, d: 0.7, h: 1.85 },
  island: { w: 1.6, d: 0.85, h: 0.9 },
  toilet: { w: 0.42, d: 0.65, h: 0.75 },
  basin: { w: 0.62, d: 0.46, h: 0.86 },
  shower: { w: 0.95, d: 0.95, h: 2.0 },
  bathtub: { w: 1.6, d: 0.75, h: 0.56 },
  washer: { w: 0.62, d: 0.62, h: 0.86 },
  plant: { w: 0.5, d: 0.5, h: 1.15 },
  lamp: { w: 0.34, d: 0.34, h: 1.6 },
  piano: { w: 1.5, d: 0.62, h: 1.2 },
  rug: { w: 2.0, d: 1.4, h: 0.02, solid: false },
  // Hospital (mm3d-26): leito (mesmo colchão da cama, para a pose de deitar
  // servir igual), suporte de soro, monitor, biombo, balcão e armário.
  hbed: { w: 1.0, d: 2.1, h: 0.5, beds: [[0, 0]] },
  ivpole: { w: 0.44, d: 0.44, h: 1.9 },
  monitor: { w: 0.55, d: 0.42, h: 1.45 },
  screen: { w: 1.6, d: 0.08, h: 1.8 },
  reception: { w: 2.6, d: 0.8, h: 1.05 },
  cabinet: { w: 0.9, d: 0.45, h: 1.2 },
});

const DEG = Math.PI / 180;

function round(v) {
  return Math.round(v * 1000) / 1000;
}

/** Mesma convenção do Babylon (Matrix.RotationY, mão esquerda). */
function rotY(x, z, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: x * c + z * s, z: -x * s + z * c };
}

/** Tamanho efetivo do móvel (largura/profundidade/altura podem ser ajustadas na planta). */
function furnitureSize(item) {
  const t = FURNITURE[item.t];
  if (!t) throw new Error(`móvel desconhecido: ${item.t}`);
  return { w: item.w ?? t.w, d: item.d ?? t.d, h: item.h ?? t.h, solid: t.solid !== false };
}

/** Caixa alinhada do móvel no plano (giros de 90°). */
function furnitureBox(item) {
  const s = furnitureSize(item);
  const turned = Math.round(item.r / 90) % 2 !== 0;
  return {
    x: item.x,
    z: item.z,
    hx: (turned ? s.d : s.w) / 2,
    hz: (turned ? s.w : s.d) / 2,
    h: s.h,
  };
}

// ── Paredes a partir dos cômodos ─────────────────────────────────────────────
function overlap(a0, a1, b0, b1) {
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  return hi - lo > 0.02 ? [lo, hi] : null;
}

function subtract(interval, cuts) {
  let parts = [interval];
  for (const [c0, c1] of cuts) {
    const next = [];
    for (const [p0, p1] of parts) {
      if (c1 <= p0 || c0 >= p1) next.push([p0, p1]);
      else {
        if (c0 > p0) next.push([p0, c0]);
        if (c1 < p1) next.push([c1, p1]);
      }
    }
    parts = next;
  }
  return parts.filter(([a, b]) => b - a > 0.05);
}

/**
 * Segmentos de parede de um andar. Cada um: eixo ("x" = corre em X, linha em
 * z fixo), coordenada fixa, intervalo, tipo (ext | int | facade | rail) e de
 * que lado fica o interior (para recuar a parede externa para dentro).
 */
function wallSegments(rooms, openPairs) {
  const isOpen = (a, b) => openPairs.some(([p, q]) => (p === a && q === b) || (p === b && q === a));
  const segs = [];
  rooms.forEach((r, ri) => {
    const edges = [
      { axis: "x", at: r.z0, a0: r.x0, a1: r.x1, inward: +1, other: (s) => Math.abs(s.z1 - r.z0) < EPS, span: (s) => [s.x0, s.x1] },
      { axis: "x", at: r.z1, a0: r.x0, a1: r.x1, inward: -1, other: (s) => Math.abs(s.z0 - r.z1) < EPS, span: (s) => [s.x0, s.x1] },
      { axis: "z", at: r.x0, a0: r.z0, a1: r.z1, inward: +1, other: (s) => Math.abs(s.x1 - r.x0) < EPS, span: (s) => [s.z0, s.z1] },
      { axis: "z", at: r.x1, a0: r.z0, a1: r.z1, inward: -1, other: (s) => Math.abs(s.x0 - r.x1) < EPS, span: (s) => [s.z0, s.z1] },
    ];
    for (const e of edges) {
      const covered = [];
      rooms.forEach((s, si) => {
        if (si === ri || !e.other(s)) return;
        const [b0, b1] = e.span(s);
        const ov = overlap(e.a0, e.a1, b0, b1);
        if (!ov) return;
        covered.push(ov);
        if (si < ri) return; // a parede compartilhada é emitida uma vez só
        if (isOpen(r.id, s.id)) return;
        if (r.outdoor && s.outdoor) return;
        if (r.outdoor !== s.outdoor) {
          // Fachada entre dentro e sacada: parede cheia do lado de dentro.
          const inside = r.outdoor ? -e.inward : e.inward;
          segs.push({ axis: e.axis, at: e.at, a0: ov[0], a1: ov[1], kind: "facade", inward: inside });
          return;
        }
        segs.push({ axis: e.axis, at: e.at, a0: ov[0], a1: ov[1], kind: "int", inward: 0 });
      });
      for (const [p0, p1] of subtract([e.a0, e.a1], covered)) {
        segs.push({ axis: e.axis, at: e.at, a0: p0, a1: p1, kind: r.outdoor ? "rail" : "ext", inward: e.inward });
      }
    }
  });
  return segs;
}

/** Recorta portas e passagens dos segmentos (a abertura é um ponto na linha da parede + largura). */
function cutOpenings(segs, openings) {
  const out = [];
  const used = new Set();
  for (const sg of segs) {
    const cuts = [];
    openings.forEach((o, i) => {
      const on = sg.axis === "x" ? Math.abs(o.z - sg.at) < 0.12 : Math.abs(o.x - sg.at) < 0.12;
      const p = sg.axis === "x" ? o.x : o.z;
      if (!on || p < sg.a0 - EPS || p > sg.a1 + EPS) return;
      cuts.push([p - o.w / 2, p + o.w / 2]);
      used.add(i);
    });
    const pieces = subtract([sg.a0, sg.a1], cuts.sort((a, b) => a[0] - b[0]));
    for (const [a0, a1] of pieces) out.push({ ...sg, a0, a1, cut: cuts.length > 0 });
    sg.cuts = cuts;
  }
  const missing = openings.filter((_, i) => !used.has(i));
  if (missing.length) throw new Error(`abertura fora de parede: ${JSON.stringify(missing)}`);
  return out;
}

/** Caixa de uma peça de parede (h relativo ao piso). */
function wallBox(sg) {
  const t = sg.kind === "rail" ? 0.12 : WALL_T;
  // Externa: recuada para dentro (a face de fora fica na borda do cômodo).
  const off = sg.kind === "int" ? 0 : sg.inward * (t / 2);
  const mid = (sg.a0 + sg.a1) / 2;
  const half = (sg.a1 - sg.a0) / 2;
  const h = sg.kind === "rail" ? RAIL_H : WALL_H;
  return sg.axis === "x"
    ? { x: mid, z: sg.at + off, hx: half, hz: t / 2, h }
    : { x: sg.at + off, z: mid, hx: t / 2, hz: half, h };
}

/** Janelas (só desenho): ao longo das paredes externas, longe de cantos e portas. */
function windowsFor(segs) {
  const out = [];
  for (const sg of segs) {
    if (sg.kind !== "ext") continue;
    const len = sg.a1 - sg.a0;
    const n = Math.floor((len - 0.5) / 2.2);
    if (n < 1) continue;
    for (let i = 0; i < n; i++) {
      const p = sg.a0 + (len * (i + 0.5)) / n;
      if ((sg.cuts || []).some(([c0, c1]) => p > c0 - 0.9 && p < c1 + 0.9)) continue;
      const off = sg.inward * (WALL_T / 2);
      out.push(
        sg.axis === "x"
          ? { x: round(p), z: round(sg.at + off), axis: "x", inward: sg.inward }
          : { x: round(sg.at + off), z: round(p), axis: "z", inward: sg.inward }
      );
    }
  }
  return out;
}

/** Retângulo menos buracos (vão da escada na laje). */
function rectMinus(r, holes) {
  let parts = [{ x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 }];
  for (const h of holes) {
    const next = [];
    for (const p of parts) {
      const ix0 = Math.max(p.x0, h.x0);
      const ix1 = Math.min(p.x1, h.x1);
      const iz0 = Math.max(p.z0, h.z0);
      const iz1 = Math.min(p.z1, h.z1);
      if (ix1 - ix0 < EPS || iz1 - iz0 < EPS) {
        next.push(p);
        continue;
      }
      if (p.z0 < iz0) next.push({ x0: p.x0, z0: p.z0, x1: p.x1, z1: iz0 });
      if (iz1 < p.z1) next.push({ x0: p.x0, z0: iz1, x1: p.x1, z1: p.z1 });
      if (p.x0 < ix0) next.push({ x0: p.x0, z0: iz0, x1: ix0, z1: iz1 });
      if (ix1 < p.x1) next.push({ x0: ix1, z0: iz0, x1: p.x1, z1: iz1 });
    }
    parts = next;
  }
  return parts;
}

/** Corrimãos e barreiras da escada em um andar (ver meuMundoInteriorMotion.js). */
function stairGuards(st, floor) {
  const T = 0.12;
  const out = [];
  const along = st.dir === "+z" || st.dir === "-z" ? "z" : "x";
  // Lados (os dois andares).
  if (along === "z") {
    out.push({ x: st.x0 - T / 2, z: (st.z0 + st.z1) / 2, hx: T / 2, hz: (st.z1 - st.z0) / 2 });
    out.push({ x: st.x1 + T / 2, z: (st.z0 + st.z1) / 2, hx: T / 2, hz: (st.z1 - st.z0) / 2 });
  } else {
    out.push({ x: (st.x0 + st.x1) / 2, z: st.z0 - T / 2, hx: (st.x1 - st.x0) / 2, hz: T / 2 });
    out.push({ x: (st.x0 + st.x1) / 2, z: st.z1 + T / 2, hx: (st.x1 - st.x0) / 2, hz: T / 2 });
  }
  // Ponta: no andar de baixo, barreira além do ALTO (não se passa por baixo
  // do patamar); no de cima, barreira além do PÉ (ninguém cai no vão).
  const topEnd = floor === st.from;
  const end = {
    "+z": topEnd ? { z: st.z1 + T / 2 } : { z: st.z0 - T / 2 },
    "-z": topEnd ? { z: st.z0 - T / 2 } : { z: st.z1 + T / 2 },
    "+x": topEnd ? { x: st.x1 + T / 2 } : { x: st.x0 - T / 2 },
    "-x": topEnd ? { x: st.x0 - T / 2 } : { x: st.x1 + T / 2 },
  }[st.dir];
  if (along === "z") out.push({ x: (st.x0 + st.x1) / 2, z: end.z, hx: (st.x1 - st.x0) / 2 + T, hz: T / 2 });
  else out.push({ x: end.x, z: (st.z0 + st.z1) / 2, hx: T / 2, hz: (st.z1 - st.z0) / 2 + T });
  return out;
}

/**
 * Monta a definição completa de um interior a partir da planta. Lança erro
 * em planta incoerente (abertura fora de parede, móvel desconhecido, escada
 * que não liga andares vizinhos) — falha no boot, não na produção.
 */
function buildInterior(plan) {
  const floors = plan.floors.map((fl, fi) => {
    const y = fi * FLOOR_H;
    const segs = wallSegments(fl.rooms, fl.open || []);
    // A porta da rua é uma abertura como as outras (térreo).
    const doors = fi === 0 ? [...(fl.doors || []), { x: plan.door.x, z: plan.door.z, w: plan.door.w }] : fl.doors || [];
    const walls = cutOpenings(segs, doors);
    const holes = (plan.stairs || []).filter((s) => s.to === fi).map((s) => ({ x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1 }));
    const boxes = [];
    for (const w of walls) {
      const b = wallBox(w);
      boxes.push({ x: round(b.x), z: round(b.z), hx: round(b.hx), hz: round(b.hz), rot: 0, h: round(y + b.h) });
    }
    for (const st of plan.stairs || []) {
      if (st.from !== fi && st.to !== fi) continue;
      for (const g of stairGuards(st, fi)) boxes.push({ x: round(g.x), z: round(g.z), hx: round(g.hx), hz: round(g.hz), rot: 0, h: round(y + RAIL_H) });
    }
    const furniture = (fl.furniture || []).map(([t, x, z, r = 0, extra = {}]) => ({ t, x, z, r, ...extra }));
    for (const it of furniture) {
      const s = furnitureSize(it);
      if (!s.solid) continue;
      const b = furnitureBox(it);
      boxes.push({ x: round(b.x), z: round(b.z), hx: round(b.hx), hz: round(b.hz), rot: 0, h: round(y + b.h) });
    }
    const bounds = {
      minX: Math.min(...fl.rooms.map((r) => r.x0)),
      maxX: Math.max(...fl.rooms.map((r) => r.x1)),
      minZ: Math.min(...fl.rooms.map((r) => r.z0)),
      maxZ: Math.max(...fl.rooms.map((r) => r.z1)),
    };
    return {
      y,
      bounds,
      rooms: fl.rooms.map((r) => ({ ...r })),
      walls: walls.map((w) => {
        const b = wallBox(w);
        return { x: round(b.x), z: round(b.z), hx: round(b.hx), hz: round(b.hz), h: b.h, kind: w.kind };
      }),
      windows: windowsFor(segs),
      slabs: fi === 0 ? null : fl.rooms.flatMap((r) => rectMinus(r, holes).map((p) => ({ ...p, mat: r.mat }))),
      furniture,
      boxes,
    };
  });

  for (const st of plan.stairs || []) {
    if (st.to !== st.from + 1 || !floors[st.to]) throw new Error(`escada inválida no nível ${plan.level}`);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const fl of plan.floors) {
    for (const r of fl.rooms) {
      minX = Math.min(minX, r.x0);
      maxX = Math.max(maxX, r.x1);
      minZ = Math.min(minZ, r.z0);
      maxZ = Math.max(maxZ, r.z1);
    }
  }
  const def = {
    level: plan.level,
    version: plan.version,
    name: plan.name,
    floors,
    stairs: (plan.stairs || []).map((s) => ({ ...s })),
    bounds: { minX, maxX, minZ, maxZ },
  };

  const door = plan.door;
  def.entry = { x: door.x, z: round(door.z + 1.0), facing: 0, floor: 0 };
  def.exit = { x: door.x, z: round(door.z + 0.55), radius: 1.6, floor: 0 };
  def.door = { x: door.x, z: door.z, w: door.w };

  // Assentos: um id estável por posição, ponto de levantar = o primeiro
  // lugar livre E ALCANÇÁVEL (percurso real a partir da entrada) em frente,
  // dos lados ou atrás do móvel — livre num canto fechado não serve.
  const walk = walkInterior({ ...def, seats: [] });
  const reachable = (fi, c) => walk.cells.some((w) => w.floor === fi && Math.hypot(w.x - c.x, w.z - c.z) <= 0.2);
  const seats = [];
  const problems = [];
  // Ponto de levantar: o primeiro candidato (coordenadas locais do móvel)
  // livre, alcançável, no MESMO cômodo do móvel (livre do outro lado de uma
  // parede seria atravessá-la) e a menos de `reach` − 0,25 do ponto onde o
  // personagem fica.
  const standPoint = (fl, fi, it, at, cands, reach) => {
    const rot = it.r * DEG;
    const room = fl.rooms.find((r) => it.x >= r.x0 && it.x <= r.x1 && it.z >= r.z0 && it.z <= r.z1);
    const inRoom = (c) => room && c.x > room.x0 && c.x < room.x1 && c.z > room.z0 && c.z < room.z1;
    for (const [lx, lz] of cands) {
      const q = rotY(lx, lz, rot);
      const c = { x: round(it.x + q.x), z: round(it.z + q.z) };
      const close = Math.hypot(c.x - at.x, c.z - at.z) <= reach - 0.25;
      if (close && inRoom(c) && isFreeSpot(def, fi, c.x, c.z) && reachable(fi, c)) return c;
    }
    return null;
  };
  floors.forEach((fl, fi) => {
    fl.furniture.forEach((it) => {
      const kind = FURNITURE[it.t];
      if (!kind.seats) return;
      const s = furnitureSize(it);
      const rot = it.r * DEG;
      for (const [sx, sz] of kind.seats) {
        const p = rotY(sx, sz, rot);
        const fwd = rotY(0, -1, rot);
        const facing = Math.atan2(fwd.x, fwd.z);
        const reach = MOTION.RADIUS + 0.12;
        // Em frente; dos lados (um pouco recuado, para não raspar na mesa à
        // frente da cadeira); atrás.
        const cands = [
          [sx, -(s.d / 2 + reach)],
          [-(s.w / 2 + reach), sz + 0.22],
          [s.w / 2 + reach, sz + 0.22],
          [-(s.w / 2 + reach), sz],
          [s.w / 2 + reach, sz],
          [sx, s.d / 2 + reach],
        ];
        // O ponto de levantar fica no MESMO cômodo do móvel: livre do outro
        // lado de uma parede não serve (seria atravessá-la).
        const stand = standPoint(fl, fi, it, { x: it.x + p.x, z: it.z + p.z }, cands, SEAT_REACH);
        if (!stand) problems.push(`assento sem lugar para levantar (${it.t} em ${it.x},${it.z}, piso ${fi})`);
        if (stand) seats.push({
          id: `s${String(seats.length + 1).padStart(2, "0")}`,
          floor: fi,
          x: round(it.x + p.x),
          z: round(it.z + p.z),
          facing: round(facing),
          stand,
          kind: it.t,
        });
      }
    });
  });
  def.seats = seats;
  def.seatTop = SEAT_TOP;

  // Camas (mm3d-13): o mesmo esquema dos assentos. Levanta pelo lado do
  // colchão em que deitou, depois o outro lado, depois os pés.
  const beds = [];
  floors.forEach((fl, fi) => {
    fl.furniture.forEach((it) => {
      const kind = FURNITURE[it.t];
      if (!kind.beds) return;
      const s = furnitureSize(it);
      const rot = it.r * DEG;
      const fwd = rotY(0, -1, rot);
      const facing = Math.atan2(fwd.x, fwd.z);
      const reach = MOTION.RADIUS + 0.12;
      for (const [bx, bz] of kind.beds) {
        const p = rotY(bx, bz, rot);
        const at = { x: it.x + p.x, z: it.z + p.z };
        const side = bx > 0 ? 1 : -1;
        const cands = [
          [side * (s.w / 2 + reach), bz],
          [side * (s.w / 2 + reach), bz - 0.5],
          [-side * (s.w / 2 + reach), bz],
          [-side * (s.w / 2 + reach), bz - 0.5],
          [bx, -(s.d / 2 + reach)],
        ];
        const stand = standPoint(fl, fi, it, at, cands, BED_REACH);
        if (!stand) {
          problems.push(`cama sem lugar para levantar (${it.t} em ${it.x},${it.z}, piso ${fi})`);
          continue;
        }
        beds.push({
          id: `b${String(beds.length + 1).padStart(2, "0")}`,
          floor: fi,
          x: round(at.x),
          z: round(at.z),
          facing: round(facing),
          stand,
          kind: it.t,
        });
      }
    });
  });
  def.beds = beds;
  def.bedTop = BED_TOP;

  // Geladeiras (mm3d-28): o ponto em pé em frente à porta, olhando para ela.
  // A porta é a face −z local do móvel (onde o puxador é desenhado).
  const fridges = [];
  floors.forEach((fl, fi) => {
    fl.furniture.forEach((it) => {
      if (it.t !== "fridge") return;
      const s = furnitureSize(it);
      const rot = it.r * DEG;
      const reach = MOTION.RADIUS + 0.2;
      const at = { x: it.x, z: it.z };
      const front = s.d / 2 + reach;
      const cands = [];
      for (const dz of [-0.15, 0, 0.25, 0.5]) for (const dx of [0, -0.3, 0.3, -0.55, 0.55]) cands.push([dx, -(front + dz)]);
      const stand = standPoint(fl, fi, it, at, cands, front + 1.1);
      // Sem lugar em frente a casa continua montando (a geladeira só não abre);
      // o teste das plantas exige uma geladeira utilizável em todo nível.
      if (!stand) {
        (def.warnings = def.warnings || []).push(`geladeira sem lugar em frente (${it.x},${it.z}, piso ${fi})`);
        return;
      }
      const back = rotY(0, 1, rot);
      fridges.push({
        id: `f${String(fridges.length + 1).padStart(2, "0")}`,
        floor: fi,
        x: stand.x,
        z: stand.z,
        // Olhando para a geladeira (do ponto em pé para o móvel).
        facing: round(Math.atan2(back.x, back.z)),
        center: { x: round(it.x), z: round(it.z) },
        r: it.r,
      });
    });
  });
  def.fridges = fridges;
  // Medidas-padrão de cada móvel: o cliente desenha com estas (não guarda cópia).
  def.furnitureTypes = Object.fromEntries(Object.entries(FURNITURE).map(([k, v]) => [k, { w: v.w, d: v.d, h: v.h }]));

  if (!isFreeSpot(def, 0, def.entry.x, def.entry.z)) problems.push("entrada bloqueada");
  // Só a conferência das plantas (MM_INTERIOR_DEBUG) monta uma casa com problema.
  if (problems.length && !process.env.MM_INTERIOR_DEBUG) {
    throw new Error(`interior do nível ${plan.level}: ${problems.join("; ")}`);
  }
  def.problems = problems;
  return def;
}

module.exports = { FURNITURE, FLOOR_H, WALL_T, WALL_H, RAIL_H, SEAT_TOP, SEAT_REACH, BED_TOP, BED_REACH, FRIDGE_REACH, buildInterior, furnitureBox, rotY };
