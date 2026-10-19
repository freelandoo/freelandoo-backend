// src/utils/meuMundoLayout.js
//
// MEU MUNDO 3D — o DESENHO do tipo de bairro "ring-20" do lado do servidor.
//
// Substitui o antigo meuMundoDemo.js (mm3d-01): os lotes continuam nas mesmas
// posições e com os mesmos ids públicos ("lot-01".."lot-20"), mas agora QUEM
// mora em cada casa vem do banco (mig 291) — este arquivo não sabe de dono.
//
// O que mora aqui:
//  - onde fica cada lote e para onde ele está virado (o cliente desenha);
//  - a LISTA DE OBSTÁCULOS de colisão, que vai no payload. O cliente usa
//    exatamente esta lista na predição local, e a sala multiplayer usa a MESMA
//    para validar o movimento — uma lista só, sem segunda verdade. As medidas
//    espelham o desenho de features/meu-mundo/engine/world.ts no frontend:
//    mexeu no desenho de algo que colide lá, mexe aqui também.
//  - spawn, saída e o ponto de chegada na frente de cada casa.

const MEU_MUNDO_RELEASE = "mm3d-02";

const LOT_WIDTH = 9;
const LOT_DEPTH = 12;
const RING = 26;
const ROAD_HALF = 3;
const SIDEWALK = 2;
const LOT_CENTER = RING + ROAD_HALF + SIDEWALK + LOT_DEPTH / 2; // 37
const HEDGE = 47;
const GATE_X = 48;
const EXIT_Z = RING;
const LIMIT = 70;
const LOTS_PER_NEIGHBORHOOD = 20;

const SLOTS = [-2, -1, 0, 1, 2].map((i) => i * LOT_WIDTH);
const GROUPS = [
  { side: "north", rotationY: 0, at: (s) => ({ x: s, z: LOT_CENTER }) },
  { side: "east", rotationY: Math.PI / 2, at: (s) => ({ x: LOT_CENTER, z: -s }) },
  { side: "south", rotationY: Math.PI, at: (s) => ({ x: -s, z: -LOT_CENTER }) },
  { side: "west", rotationY: -Math.PI / 2, at: (s) => ({ x: -LOT_CENTER, z: s }) },
];

const pad2 = (n) => String(n).padStart(2, "0");
const round = (v) => Math.round(v * 1000) / 1000;

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

/** Ponto na calçada em frente à casa, olhando para a rua. */
function frontOfHouse(lotNumber) {
  const lot = LOTS[lotNumber - 1];
  const p = rotY(0, -6.6, lot.rotationY);
  const out = rotY(0, -1, lot.rotationY);
  return {
    x: round(lot.position.x + p.x),
    z: round(lot.position.z + p.z),
    rotationY: round(Math.atan2(out.x, out.z)),
  };
}

function buildObstacles() {
  const boxes = [];
  const push = (x, z, hx, hz, rot, h) =>
    boxes.push({ x: round(x), z: round(z), hx: round(hx), hz: round(hz), rot: round(rot), h: round(h) });
  const tree = (x, z, s = 1) => push(x, z, 0.35 * s, 0.35 * s, 0, 3.4 * s);

  // Casas (corpo, cercas laterais e do fundo, placa) + árvore do quintal.
  for (const lot of LOTS) {
    const v = houseVariant(lot.number);
    const at = (lx, lz) => {
      const o = rotY(lx, lz, lot.rotationY);
      return { x: lot.position.x + o.x, z: lot.position.z + o.z };
    };
    if (v % 3 === 1) {
      const t = at(2.8, 4.3);
      tree(t.x, t.z, 0.85);
    }
    for (const [lx, lz, hx, hz, h] of [
      [0, 0.8, 2.7, 2.4, 4.6],
      [-4.35, 1.4, 0.15, 4.3, 0.7],
      [4.35, 1.4, 0.15, 4.3, 0.7],
      [0, 5.85, 4.5, 0.15, 0.7],
      [2.5, -5.35, 0.12, 0.12, 2],
    ]) {
      const p = at(lx, lz);
      push(p.x, p.z, hx, hz, lot.rotationY, h);
    }
  }

  // Praça: canteiro, bancos, postes e árvores de dentro.
  push(0, 0, 2.1, 2.1, Math.PI / 4, 1.2);
  push(0, 0, 2.1, 2.1, 0, 1.2);
  for (const [x, z] of [[4.6, 4.6], [-4.6, 4.6], [4.6, -4.6], [-4.6, -4.6]]) {
    push(x, z, 1.05, 0.38, Math.atan2(x, z), 1);
  }
  for (const sx of [-8.2, 8.2]) for (const sz of [-8.2, 8.2]) push(sx, sz, 0.2, 0.2, 0, 3.6);
  for (const sx of [-22, 22]) for (const sz of [-22, 22]) push(sx, sz, 0.2, 0.2, 0, 3.6);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      tree(14 * sx, 14 * sz, 1);
      tree(16.5 * sx, 5 * sz, 0.9);
      tree(5 * sx, 16.5 * sz, 0.9);
    }
  }

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
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      if (sx === 1 && sz === 1) continue;
      tree(36 * sx, 36 * sz, 1.1);
      tree(42 * sx, 39 * sz, 0.95);
      tree(38.5 * sx, 43 * sz, 0.9);
    }
  }
  tree(36, 38, 1.1);
  tree(42, 42, 0.95);
  return boxes;
}

const OBSTACLES = buildObstacles();

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
      width: LOT_WIDTH,
      depth: LOT_DEPTH,
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
    capacity: LOTS_PER_NEIGHBORHOOD,
    residents,
    lots,
    houses: out,
    spawn: { x: 0, z: -15, rotationY: 0 },
    exit: { id: "exit-centro", x: 45, z: RING, label: "Centro da cidade" },
    obstacles: OBSTACLES,
    limit: LIMIT,
  };
}

module.exports = {
  MEU_MUNDO_RELEASE,
  LOTS_PER_NEIGHBORHOOD,
  LOTS,
  OBSTACLES,
  LIMIT,
  houseVariant,
  frontOfHouse,
  rotY,
  buildNeighborhoodPayload,
};
