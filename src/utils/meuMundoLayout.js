// src/utils/meuMundoLayout.js
//
// MEU MUNDO 3D — o DESENHO do tipo de bairro "ring-20" do lado do servidor.
//
// Os ids públicos ("lot-01".."lot-20", "house-01".."house-20") e a ordem dos
// lotes são estáveis desde o mm3d-01; QUEM mora em cada casa vem do banco
// (mig 291) — este arquivo não sabe de dono.
//
// O que mora aqui:
//  - LOT_PLAN: a configuração ÚNICA do lote (medidas, recuos, área edificável,
//    referência da casa, acesso, placa, cercas, decoração). Vai inteira no
//    payload; o cliente desenha a partir dela, e os colisores saem dela aqui.
//  - DIMS: as medidas do bairro (anel, calçadas, cerca, portão, gramado).
//    Também vão no payload — o cliente não guarda uma segunda cópia.
//  - a LISTA DE OBSTÁCULOS de colisão, que vai no payload. O cliente usa
//    exatamente esta lista na predição local, e a sala multiplayer usa a MESMA
//    para validar o movimento — uma lista só, sem segunda verdade.
//  - spawn, saída e o ponto de chegada na frente de cada casa.

const MEU_MUNDO_RELEASE = "mm3d-03";

// Versão do DESENHO do bairro. Posição guardada num desenho anterior não vale
// neste (o que era calçada pode ter virado quintal): quem a lê confere a versão.
const LAYOUT_VERSION = 2;
const LOTS_PER_NEIGHBORHOOD = 20;

// ═══ O LOTE ═══ — coordenadas LOCAIS, em metros, origem no centro do terreno
// e a FRENTE no -Z (rua). Vale para os quatro lados do anel: a rotação do lote
// leva frente, fundos e laterais junto.
//
// mm3d-02 era 9 × 12 m, com a casa a 4,4 m da frente, 1,8 m de cada lado e
// 2,8 m do fundo. O mm3d-03 dobra largura e profundidade (18 × 24) e distribui
// o espaço novo nos três lados: frente 7 m, laterais 6,3 m, fundo 12,2 m.
const LOT_PLAN = Object.freeze({
  width: 18,
  depth: 24,
  // Recuos a partir das divisas. O que fica dentro deles é a ÁREA EDIFICÁVEL:
  // o espaço máximo para as casas dos níveis 02–10 (ainda não modeladas).
  setbacks: Object.freeze({ front: 4, side: 1.5, back: 1.5 }),
  // Ponto de referência da construção: o MEIO DA FACHADA. Casas maiores
  // crescem para os lados e para os fundos a partir desta linha.
  houseFront: Object.freeze({ x: 0, z: -5 }),
  // Onde o lote encontra a calçada (início do caminho da porta).
  access: Object.freeze({ x: 0, z: -12 }),
  sign: Object.freeze({ x: 2.5, z: -11.35 }),
  // Cerca viva baixa: laterais e fundo; a frente fica aberta para a rua.
  hedge: Object.freeze({ thickness: 0.3, height: 0.7, frontGap: 3.1 }),
  // Decoração fixa no jardim da FRENTE, fora do miolo da área edificável.
  tree: Object.freeze({ x: 6, z: -9.8, scale: 0.85 }),
  flowers: Object.freeze({ x: -3.4, z: -9.4 }),
});

// Casa nível 01 — medidas INALTERADAS desde o mm3d-01 (base 5,4 × 4,8 m).
const HOUSE_L1 = Object.freeze({
  width: 5.4,
  depth: 4.8,
  height: 4.6,
  pathWidth: 1.3,
  stepDepth: 0.6,
  stepWidth: 1.6,
});

function round(v) {
  return Math.round(v * 1000) / 1000;
}

/** Área edificável do lote (coordenadas locais). */
function buildableArea(plan = LOT_PLAN) {
  const s = plan.setbacks;
  return {
    minX: -plan.width / 2 + s.side,
    maxX: plan.width / 2 - s.side,
    minZ: -plan.depth / 2 + s.front,
    maxZ: plan.depth / 2 - s.back,
  };
}

/**
 * Medidas do lote para conferência: área livre de JARDIM = terreno menos a
 * base da casa, o caminho, o degrau e a própria cerca viva. A mesma conta
 * vale para o desenho antigo e o novo (o teste compara os dois).
 */
function lotMetrics(plan = LOT_PLAN, house = HOUSE_L1) {
  const area = plan.width * plan.depth;
  const houseArea = house.width * house.depth;
  // O degrau avança 0,45 m além da fachada (0,15 m dele fica sobre a base).
  const stepFront = plan.houseFront.z - (house.stepDepth - 0.15);
  const pathArea = house.pathWidth * (stepFront - plan.access.z);
  const stepArea = house.stepWidth * (house.stepDepth - 0.15);
  const t = plan.hedge.thickness;
  const hedgeArea = 2 * t * (plan.depth - plan.hedge.frontGap - t) + plan.width * t;
  const garden = area - houseArea - pathArea - stepArea - hedgeArea;
  return {
    area: round(area),
    houseArea: round(houseArea),
    paved: round(pathArea + stepArea),
    hedgeArea: round(hedgeArea),
    garden: round(garden),
    yards: {
      front: round(plan.houseFront.z + plan.depth / 2),
      side: round(plan.width / 2 - house.width / 2),
      back: round(plan.depth / 2 - (plan.houseFront.z + house.depth)),
    },
  };
}

// ═══ O BAIRRO ═══ — anel de ruas, praça no meio, quatro quadras de cinco
// lotes por fora, cerca viva e portão do Centro na rua do canto nordeste.
// Larguras de rua (6 m) e calçada (2 m) são as do mm3d-02; o que cresceu foi o
// raio do anel, para caber cinco lotes de 18 m por quadra (90 m de frente).
const ROAD_HALF = 3;
const SIDEWALK = 2;
const HALF_SPAN = (5 * LOT_PLAN.width) / 2; // 45
// A quadra leste termina antes da calçada da rua de saída (canto nordeste).
const RING = HALF_SPAN + ROAD_HALF + SIDEWALK; // 50
const LOT_FRONT = RING + ROAD_HALF + SIDEWALK; // 55
const LOT_CENTER = LOT_FRONT + LOT_PLAN.depth / 2; // 67
const HEDGE = LOT_FRONT + LOT_PLAN.depth + 4; // 83 — 4 m atrás dos fundos, como antes
const GATE_X = HEDGE + 1; // 84
const EXIT_Z = RING;
const EXIT_END = GATE_X + 22; // 106
const LIMIT = HEDGE + 23; // 106
const INNER_WALK = RING - ROAD_HALF - SIDEWALK; // 45

// Árvores e postes do gramado foram posicionados no desenho do mm3d-02 e são
// REMAPEADOS para o tamanho atual (mesma quantidade, mesma composição).
const REF = Object.freeze({ innerWalk: 21, lotFront: 31, hedge: 47 });
const corner = (v) => LOT_FRONT + ((v - REF.lotFront) * (HEDGE - LOT_FRONT)) / (REF.hedge - REF.lotFront);

function lawnPositions() {
  const k = INNER_WALK / REF.innerWalk;
  const plazaTrees = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      plazaTrees.push([round(14 * k * sx), round(14 * k * sz), 1]);
      plazaTrees.push([round(16.5 * k * sx), round(5 * k * sz), 0.9]);
      plazaTrees.push([round(5 * k * sx), round(16.5 * k * sz), 0.9]);
    }
  }
  const plazaFlowers = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) plazaFlowers.push([round(11 * k * sx), round(11 * k * sz)]);
  const cornerTrees = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      if (sx === 1 && sz === 1) continue;
      cornerTrees.push([round(corner(36) * sx), round(corner(36) * sz), 1.1]);
      cornerTrees.push([round(corner(42) * sx), round(corner(39) * sz), 0.95]);
      cornerTrees.push([round(corner(38.5) * sx), round(corner(43) * sz), 0.9]);
    }
  }
  // Nordeste: acima da rua de saída.
  cornerTrees.push([round(corner(36)), round(corner(38)), 1.1]);
  cornerTrees.push([round(corner(42)), round(corner(42)), 0.95]);
  // De fora da cerca (só desenho, não colidem).
  const s = HEDGE / REF.hedge;
  const outer = [
    [-55, 30, 1.3], [-58, -12, 1.4], [-52, -44, 1.2], [-20, -56, 1.4], [18, -55, 1.3],
    [50, -52, 1.2], [57, -15, 1.4], [57, 10, 1.2], [56, 40, 1.3], [30, 57, 1.4],
    [-10, 58, 1.3], [-45, 54, 1.2], [62, 33, 1.1], [64, 19, 1.2],
  ].map(([x, z, sc]) => [round(x * s), round(z * s), sc]);
  return { plazaTrees, plazaFlowers, cornerTrees, outerTrees: outer };
}

const DIMS = Object.freeze({
  ring: RING,
  roadHalf: ROAD_HALF,
  sidewalk: SIDEWALK,
  lotFront: LOT_FRONT,
  hedge: HEDGE,
  gateX: GATE_X,
  exitZ: EXIT_Z,
  exitEnd: EXIT_END,
  innerWalk: INNER_WALK,
  ...lawnPositions(),
});

const SLOTS = [-2, -1, 0, 1, 2].map((i) => i * LOT_PLAN.width);
const GROUPS = [
  { side: "north", rotationY: 0, at: (s) => ({ x: s, z: LOT_CENTER }) },
  { side: "east", rotationY: Math.PI / 2, at: (s) => ({ x: LOT_CENTER, z: -s }) },
  { side: "south", rotationY: Math.PI, at: (s) => ({ x: -s, z: -LOT_CENTER }) },
  { side: "west", rotationY: -Math.PI / 2, at: (s) => ({ x: -LOT_CENTER, z: s }) },
];

const pad2 = (n) => String(n).padStart(2, "0");

/** Mesma convenção do Babylon (Matrix.RotationY, mão esquerda) e do cliente. */
function rotY(x, z, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: x * c + z * s, z: -x * s + z * c };
}

/** Variação visual estável por casa (cores), igual ao mm3d-01. */
function houseVariant(n) {
  return (n * 7) % 12;
}

/** A casa desta variação tem árvore no jardim (mesma regra do cliente). */
const hasTree = (variant) => variant % 3 === 1;

function lotGeometry() {
  const lots = [];
  let n = 0;
  for (const group of GROUPS) {
    for (const s of SLOTS) {
      n += 1;
      const { x, z } = group.at(s);
      lots.push({ number: n, side: group.side, position: { x, z }, rotationY: group.rotationY });
    }
  }
  return lots;
}

const LOTS = lotGeometry();

/** Ponto local do lote → mundo. */
function lotToWorld(lot, lx, lz) {
  const o = rotY(lx, lz, lot.rotationY);
  return { x: lot.position.x + o.x, z: lot.position.z + o.z };
}

/** Ponto na calçada em frente à casa, olhando para a rua. */
function frontOfHouse(lotNumber) {
  const lot = LOTS[lotNumber - 1];
  const p = lotToWorld(lot, LOT_PLAN.access.x, LOT_PLAN.access.z - 0.6);
  const out = rotY(0, -1, lot.rotationY);
  return { x: round(p.x), z: round(p.z), rotationY: round(Math.atan2(out.x, out.z)) };
}

/**
 * Caixas de colisão de UM lote em coordenadas locais:
 * [lx, lz, hx, hz, altura, gira-com-o-lote].
 */
function lotObstacles(variant, plan = LOT_PLAN, house = HOUSE_L1) {
  const t = plan.hedge.thickness;
  const zStart = -plan.depth / 2 + plan.hedge.frontGap;
  const zEnd = plan.depth / 2 - t;
  const sideX = plan.width / 2 - t / 2;
  const hc = plan.houseFront.z + house.depth / 2;
  const out = [
    [plan.houseFront.x, hc, house.width / 2, house.depth / 2, house.height, true],
    [-sideX, (zStart + zEnd) / 2, t / 2, (zEnd - zStart) / 2, plan.hedge.height, true],
    [sideX, (zStart + zEnd) / 2, t / 2, (zEnd - zStart) / 2, plan.hedge.height, true],
    [0, plan.depth / 2 - t / 2, plan.width / 2, t / 2, plan.hedge.height, true],
    [plan.sign.x, plan.sign.z, 0.12, 0.12, 2, true],
  ];
  if (hasTree(variant)) {
    const s = plan.tree.scale;
    // Árvore: caixa sem rotação (é o tronco), como as do resto do bairro.
    out.push([plan.tree.x, plan.tree.z, 0.35 * s, 0.35 * s, 3.4 * s, false]);
  }
  return out;
}

function buildObstacles() {
  const boxes = [];
  const push = (x, z, hx, hz, rot, h) =>
    boxes.push({ x: round(x), z: round(z), hx: round(hx), hz: round(hz), rot: round(rot), h: round(h) });
  const tree = (x, z, s = 1) => push(x, z, 0.35 * s, 0.35 * s, 0, 3.4 * s);

  // Lotes: casa, cercas laterais e do fundo, placa e (às vezes) a árvore.
  for (const lot of LOTS) {
    for (const [lx, lz, hx, hz, h, turns] of lotObstacles(houseVariant(lot.number))) {
      const p = lotToWorld(lot, lx, lz);
      push(p.x, p.z, hx, hz, turns ? lot.rotationY : 0, h);
    }
  }

  // Praça: canteiro, bancos e postes do miolo (tamanho fixo) e, no gramado,
  // os postes das esquinas da calçada e as árvores.
  push(0, 0, 2.1, 2.1, Math.PI / 4, 1.2);
  push(0, 0, 2.1, 2.1, 0, 1.2);
  for (const [x, z] of [[4.6, 4.6], [-4.6, 4.6], [4.6, -4.6], [-4.6, -4.6]]) {
    push(x, z, 1.05, 0.38, Math.atan2(x, z), 1);
  }
  for (const sx of [-8.2, 8.2]) for (const sz of [-8.2, 8.2]) push(sx, sz, 0.2, 0.2, 0, 3.6);
  const lampAt = INNER_WALK + 1;
  for (const sx of [-lampAt, lampAt]) for (const sz of [-lampAt, lampAt]) push(sx, sz, 0.2, 0.2, 0, 3.6);
  for (const [x, z, s] of DIMS.plazaTrees) tree(x, z, s);

  // Cerca viva em volta, aberta só na rua de saída (onde fica o portão).
  const hedge = (x, z, w, d) => push(x, z, w / 2, d / 2, 0, 1.5);
  const L = 2 * HEDGE + 1;
  hedge(0, HEDGE, L, 1);
  hedge(0, -HEDGE, L, 1);
  hedge(-HEDGE, 0, 1, L);
  const gapLo = RING - ROAD_HALF - 2;
  const gapHi = RING + ROAD_HALF + 2;
  hedge(HEDGE, (-HEDGE - 0.5 + gapLo) / 2, 1, gapLo + HEDGE + 0.5);
  hedge(HEDGE, (gapHi + HEDGE + 0.5) / 2, 1, HEDGE + 0.5 - gapHi);
  for (const z of [gapLo + 0.5, gapHi - 0.5]) push(GATE_X, z, 0.45, 0.45, 0, 4.4);
  const span = gapHi - gapLo - 1;
  push(GATE_X + 1, EXIT_Z, 0.6, span / 2 + 0.5, 0, 1.2);

  // Cantos entre as quadras (as árvores de fora da cerca não colidem).
  for (const [x, z, s] of DIMS.cornerTrees) tree(x, z, s);
  return boxes;
}

const OBSTACLES = buildObstacles();

/**
 * Lugar seguro para pôr alguém: dentro da cerca (ou na rua de saída até o
 * portão) e fora de qualquer obstáculo. `resolveCircle` vem da regra de
 * movimento, para não haver duas contas de colisão.
 */
function isSafeSpot(x, z, resolveCircle, radius) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const inside = Math.abs(x) < HEDGE - 0.5 - radius && Math.abs(z) < HEDGE - 0.5 - radius;
  const onExit = x > 0 && x < GATE_X && Math.abs(z - EXIT_Z) < ROAD_HALF + SIDEWALK;
  if (!inside && !onExit) return false;
  const r = resolveCircle(x, z, radius, OBSTACLES);
  return Math.hypot(r.x - x, r.z - z) < 1e-3;
}

/**
 * Monta o payload do bairro no contrato do cliente. `houses` vem do banco:
 * [{ number, variant, ownerName|null, isMine }]. Nenhum id de usuário sai
 * daqui — só o nome público do titular.
 */
function buildNeighborhoodPayload({ code, name, houses, residents }) {
  const byNumber = new Map(houses.map((h) => [h.number, h]));
  const lots = [];
  const out = [];
  for (const lot of LOTS) {
    const num = pad2(lot.number);
    const h = byNumber.get(lot.number) || { variant: houseVariant(lot.number), ownerName: null, isMine: false };
    lots.push({
      id: `lot-${num}`,
      number: lot.number,
      side: lot.side,
      position: lot.position,
      rotationY: lot.rotationY,
      width: LOT_PLAN.width,
      depth: LOT_PLAN.depth,
      houseId: `house-${num}`,
    });
    out.push({
      id: `house-${num}`,
      lotId: `lot-${num}`,
      level: 1,
      variant: h.variant,
      ownerName: h.ownerName || null,
      isMine: !!h.isMine,
    });
  }
  return {
    id: code,
    name,
    layout: "ring-20",
    layoutVersion: LAYOUT_VERSION,
    capacity: LOTS_PER_NEIGHBORHOOD,
    residents,
    lots,
    houses: out,
    lotPlan: { ...LOT_PLAN, house: HOUSE_L1, buildable: buildableArea() },
    dims: DIMS,
    spawn: { x: 0, z: -15, rotationY: 0 },
    exit: { id: "exit-centro", x: GATE_X - 3, z: EXIT_Z, label: "Centro da cidade" },
    obstacles: OBSTACLES,
    limit: LIMIT,
  };
}

module.exports = {
  MEU_MUNDO_RELEASE,
  LAYOUT_VERSION,
  LOTS_PER_NEIGHBORHOOD,
  LOT_PLAN,
  HOUSE_L1,
  DIMS,
  LOTS,
  OBSTACLES,
  LIMIT,
  buildableArea,
  lotMetrics,
  lotObstacles,
  lotToWorld,
  isSafeSpot,
  houseVariant,
  frontOfHouse,
  rotY,
  buildNeighborhoodPayload,
};
