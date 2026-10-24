// src/utils/meuMundoCenter.js
//
// MEU MUNDO 3D — o DESENHO do Centro da cidade (mm3d-17).
//
// O centro é UM projeto compartilhado por todas as salas (cada sala tem até
// 20 jogadores; ver CentroRoom em src/realtime/meuMundo.js). Nada aqui depende
// de quem está na sala: é a planta, igual para todos.
//
// O que mora aqui (fonte única — o cliente desenha a partir do payload e a
// sala valida o movimento com a MESMA lista de obstáculos):
//  - PLACES: os 10 estabelecimentos (retângulo, altura, lado da porta) e o
//    registro de destinos (entrada, área de interação, retorno, destino
//    futuro, disponibilidade). A praça é o 11º local (PLAZA_PLACE).
//  - a malha viária: anel em volta da praça (curvas de 10 m de raio no eixo),
//    avenida oeste até o portal "Bairros", estacionamentos.
//  - a praça (34 × 34 m) fechada para carros por floreiras e frades, com
//    passagem a pé nas quatro travessias.
//  - chegada a pé, vagas de chegada dos veículos e o portal de volta.
//
// Coordenadas em metros; +x leste, +z norte; `facing` = atan2(dx, dz) (0 =
// olhando para o norte), a mesma convenção do bairro.
//
// Medidas a partir da escala real: avatar 1,75 m (raio de colisão 0,42), carro
// 4,0 × 1,9 m (três círculos de 0,98 m, raio de giro ≈ 3,8 m parado e ≈ 11 m a
// 36 km/h). Rua 6 m e calçada 2 m como no bairro.

const fs = require("fs");
const path = require("path");

const CENTER_VERSION = 1; // sobe quando a planta muda: salas e posições de versões diferentes não se misturam
const CENTER_CAPACITY = 20;

const round = (v) => Math.round(v * 1000) / 1000;

// ═══ MALHA VIÁRIA ═══
const PLAZA = 17; // meia-largura da praça (34 × 34 m)
const RING = 23; // eixo do anel
const ROAD_HALF = 3;
const SIDEWALK = 2;
const CORNER_R = 10; // raio do eixo nas curvas do anel
const RING_IN = RING - ROAD_HALF; // 20: borda de dentro do asfalto
const RING_OUT = RING + ROAD_HALF; // 26: borda de fora do asfalto
const OUTER_WALK = RING_OUT + SIDEWALK; // 28: fim da calçada de fora
const FRONT = 30; // linha das fachadas (2 m de recuo depois da calçada)
const BOUND = 64; // cerca viva em volta
const LIMIT = 66; // ninguém passa daqui (clamp do movimento)
const AVENUE = Object.freeze({ z: 0, half: ROAD_HALF, x0: -RING_OUT, x1: -BOUND + 1 }); // avenida oeste até o portal
const PORTAL_X = -60;

// ═══ OS ESTABELECIMENTOS ═══
// rect = pegada no mundo; front = lado da porta (n/s/e/w); door = coordenada
// da porta ao longo da fachada; doorW = largura do vão. h = altura do corpo
// principal (o modelo pode ter torre/emblema acima — `peak`).
// zone agrupa por proximidade (comercial, educacional, atividades, cívica).
const PLACE_DEFS = [
  // Norte — comércio (fachadas viradas para o sul, z = FRONT)
  { id: "pizzaria", zone: "comercial", rect: [-32.5, -19.5, FRONT, FRONT + 12], h: 6.5, peak: 8.2, front: "s", door: -26, doorW: 1.8 },
  { id: "hamburgueria", zone: "comercial", rect: [-14.5, -1.5, FRONT, FRONT + 12], h: 6, peak: 8.6, front: "s", door: -8, doorW: 1.8 },
  { id: "supermercado", zone: "comercial", rect: [4, 30, FRONT, FRONT + 20], h: 7.5, peak: 9.4, front: "s", door: 17, doorW: 4 },
  // Leste — educação (fachadas viradas para o oeste, x = FRONT)
  { id: "universidade", zone: "educacional", rect: [FRONT, FRONT + 22, -12, 16], h: 12, peak: 16, front: "w", door: 2, doorW: 4 },
  { id: "biblioteca", zone: "educacional", rect: [FRONT, FRONT + 16, -33, -19], h: 8, peak: 10, front: "w", door: -26, doorW: 2.4 },
  { id: "escola", zone: "educacional", rect: [FRONT, FRONT + 16, -55, -39], h: 6.5, peak: 9.5, front: "w", door: -47, doorW: 2.4 },
  // Sul — atividades (fachadas viradas para o norte, z = -FRONT)
  { id: "academia", zone: "atividades", rect: [-22, -2, -FRONT - 16, -FRONT], h: 7, peak: 9.5, front: "n", door: -12, doorW: 3.4 },
  // game: o local abre um minijogo no cliente em vez de um interior (mm3d-20).
  // party: o minijogo aceita até N na mesma partida (sala JetpackRoom, mm3d-21).
  { id: "jetpack", zone: "atividades", rect: [6, 22, -FRONT - 16, -FRONT], h: 12, peak: 21, front: "n", door: 14, doorW: 2.4, game: "jetpack", party: 4 },
  // Oeste — cívica (fachadas viradas para o leste, x = -FRONT), dos dois lados da avenida
  { id: "igreja", zone: "civica", rect: [-FRONT - 24, -FRONT, 12, 28], h: 9, peak: 19, front: "e", door: 20, doorW: 2.4 },
  { id: "delegacia", zone: "civica", rect: [-FRONT - 16, -FRONT, -28, -12], h: 7, peak: 9, front: "e", door: -20, doorW: 2.4 },
];

/** Direção para FORA da fachada (de onde se chega à porta). */
const OUTWARD = Object.freeze({ n: { x: 0, z: 1 }, s: { x: 0, z: -1 }, e: { x: 1, z: 0 }, w: { x: -1, z: 0 } });

function buildPlace(def) {
  const [x0, x1, z0, z1] = def.rect;
  const out = OUTWARD[def.front];
  // Ponto da porta na fachada.
  const door =
    def.front === "n" ? { x: def.door, z: z1 } : def.front === "s" ? { x: def.door, z: z0 } : def.front === "e" ? { x: x1, z: def.door } : { x: x0, z: def.door };
  const facingOut = round(Math.atan2(out.x, out.z));
  // Origem do MODELO: meio da fachada, no chão. O modelo é feito com a frente
  // no -Z local e o corpo para o +Z; a rotação o leva ao lugar.
  const rot = Math.atan2(out.x, out.z) + Math.PI;
  const origin =
    def.front === "n" ? { x: (x0 + x1) / 2, z: z1 } : def.front === "s" ? { x: (x0 + x1) / 2, z: z0 } : def.front === "e" ? { x: x1, z: (z0 + z1) / 2 } : { x: x0, z: (z0 + z1) / 2 };
  // Eixo X local no mundo (mesma convenção do Babylon): a porta no quadro do modelo.
  const ax = { x: Math.cos(rot), z: -Math.sin(rot) };
  const doorLocalX = (door.x - origin.x) * ax.x + (door.z - origin.z) * ax.z;
  const frontW = def.front === "n" || def.front === "s" ? x1 - x0 : z1 - z0;
  const depth = def.front === "n" || def.front === "s" ? z1 - z0 : x1 - x0;
  const facingIn = round(Math.atan2(-out.x, -out.z));
  const at = (d) => ({ x: round(door.x + out.x * d), z: round(door.z + out.z * d) });
  return Object.freeze({
    id: def.id,
    zone: def.zone,
    // Nome: a chave de tradução; o texto mora nos dicionários do cliente.
    nameKey: `centerPlace_${def.id}`,
    rect: Object.freeze({ x0, x1, z0, z1 }),
    size: Object.freeze({ w: round(x1 - x0), d: round(z1 - z0), h: def.h, peak: def.peak }),
    center: Object.freeze({ x: round((x0 + x1) / 2), z: round((z0 + z1) / 2) }),
    front: def.front,
    // Para onde a FACHADA olha (o modelo é desenhado com a frente no -Z local e girado por isto).
    rotationY: round(((rot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)),
    origin: Object.freeze({ x: round(origin.x), z: round(origin.z) }),
    // Quadro do modelo: largura da fachada (X local), fundo (Z local) e a porta no X local.
    model: Object.freeze({ width: round(frontW), depth: round(depth), doorX: round(doorLocalX) }),
    door: Object.freeze({ x: round(door.x), z: round(door.z), width: def.doorW }),
    // Transformação da entrada (olhando para dentro do prédio).
    entry: Object.freeze({ ...at(0.6), facing: facingIn }),
    // Área de interação: na frente da porta, alcança a calçada.
    interact: Object.freeze({ ...at(1.6), radius: 3 }),
    // Ponto seguro de retorno dos futuros interiores (olhando para a rua).
    return: Object.freeze({ ...at(2.2), facing: facingOut }),
    // Destino: minijogo (game:<id>, mm3d-20) ou o interior futuro — nenhum
    // interior existe ainda, então só os minijogos estão disponíveis.
    destination: def.game ? `game:${def.game}` : `interior:${def.id}`,
    available: !!def.game,
    ...(def.party ? { party: def.party } : {}),
  });
}

const PLACES = Object.freeze(PLACE_DEFS.map(buildPlace));
const PLAZA_PLACE = Object.freeze({ id: "praca", zone: "praca", nameKey: "centerPlace_praca", center: { x: 0, z: 0 }, half: PLAZA });

// ═══ PRAÇA ═══ — o miolo (|x|,|z| ≤ 11) fica livre para encontro, fora o monumento.
const MONUMENT = Object.freeze({ x: 0, z: 0, radius: 2.4, h: 4.2 });
const PLAZA_TREES = Object.freeze([[13.4, 13.4], [-13.4, 13.4], [13.4, -13.4], [-13.4, -13.4]].map(([x, z]) => Object.freeze([x, z, 1.05])));
const PLAZA_BENCHES = Object.freeze(
  [
    [13.6, 6], [13.6, -6], [-13.6, 6], [-13.6, -6],
    [6, 13.6], [-6, 13.6], [6, -13.6], [-6, -13.6],
  ].map(([x, z]) => Object.freeze([x, z, round(Math.atan2(x, z))])) // encosto para fora, assento olhando para o monumento (igual ao bairro)
);
const PLAZA_LAMPS = Object.freeze([[11.6, 15.2], [-11.6, 15.2], [11.6, -15.2], [-11.6, -15.2], [15.2, 11.6], [-15.2, 11.6], [15.2, -11.6], [-15.2, -11.6]].map((p) => Object.freeze(p)));
const PLAZA_FLOWERS = Object.freeze([[9.5, 15.6], [-9.5, 15.6], [9.5, -15.6], [-9.5, -15.6], [15.6, 9.5], [-15.6, 9.5], [15.6, -9.5], [-15.6, -9.5]].map((p) => Object.freeze(p)));

// Floreiras na borda da praça (meia-largura 0,45, altura 0,6), com um frade
// no meio de cada travessia: o vão de 1,75 m deixa passar quem anda (0,84 m) e
// segura o carro (1,96 m). Nas curvas, uma floreira diagonal fecha o canto.
const PLANTER = Object.freeze({ half: 0.45, h: 0.6, from: 1.9, to: 14 });
const BOLLARD = 0.18;

function plazaEdges() {
  const planters = [];
  const bollards = [];
  const e = PLAZA - PLANTER.half;
  const seg = (x, z, hx, hz, rot = 0) => planters.push({ x: round(x), z: round(z), hx: round(hx), hz: round(hz), rot: round(rot) });
  const len = PLANTER.to - PLANTER.from;
  const mid = (PLANTER.from + PLANTER.to) / 2;
  for (const s of [-1, 1]) {
    seg(mid * s, e, len / 2, PLANTER.half);
    seg(mid * s, -e, len / 2, PLANTER.half);
    seg(e, mid * s, PLANTER.half, len / 2);
    seg(-e, mid * s, PLANTER.half, len / 2);
  }
  bollards.push([0, e], [0, -e], [e, 0], [-e, 0]);
  // Cantos: de (14, e) a (e, 14) — diagonal.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const ax = PLANTER.to * sx;
      const az = e * sz;
      const bx = e * sx;
      const bz = PLANTER.to * sz;
      const L = Math.hypot(bx - ax, bz - az);
      seg((ax + bx) / 2, (az + bz) / 2, L / 2 + PLANTER.half, PLANTER.half, Math.atan2(bx - ax, bz - az) + Math.PI / 2);
    }
  }
  return { planters, bollards };
}
const PLAZA_EDGES = plazaEdges();

// Travessias de pedestre (faixa pintada) nas quatro saídas da praça.
const CROSSWALKS = Object.freeze([
  { x: 0, z: RING, axis: "z" },
  { x: 0, z: -RING, axis: "z" },
  { x: RING, z: 0, axis: "x" },
  { x: -RING, z: 0, axis: "x" },
]);

// ═══ ESTACIONAMENTOS E CHEGADA ═══
// Vaga 2,6 × 5,0 m. `facing` = para onde o veículo aponta ao chegar.
function slotsRow(x0, z, n, facing, dx = 2.6) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ x: round(x0 + dx * i), z: round(z), facing: round(facing) });
  return out;
}
const PARKING = Object.freeze([
  // Geral, junto à avenida, atrás da delegacia: duas fileiras de frente para o corredor.
  { id: "estacionamento-oeste", rect: [-62, -48, -30, -7], slots: [...slotsRow(-60.7, -10.5, 5, Math.PI), ...slotsRow(-60.7, -26.5, 5, 0)] },
  // Supermercado, a leste dele.
  { id: "estacionamento-supermercado", rect: [33, 55, 31, 51], slots: [...slotsRow(35.5, 34, 7, 0), ...slotsRow(35.5, 47, 7, Math.PI)] },
]);
// Faixas da avenida (de leste para oeste não precisa: quem chega olha para o centro).
const AVENUE_SPOTS = Object.freeze([...slotsRow(-56, -1.5, 4, Math.PI / 2, 6), ...slotsRow(-56, 1.5, 4, Math.PI / 2, 6)]);
// Ordem de preferência para pôr um veículo que chega: avenida primeiro, depois as vagas.
const ARRIVAL_SPOTS = Object.freeze([...AVENUE_SPOTS, ...PARKING[0].slots, ...PARKING[1].slots].map((s) => Object.freeze(s)));

// Quem chega a pé: calçada norte da avenida, perto do portal, olhando para o centro.
// (x −50: a câmera, atrás da pessoa, não nasce colada no pilar do portal.)
const ARRIVAL = Object.freeze({ x: -50, z: 4.1, facing: round(Math.PI / 2) });
// Portal "Bairros": a volta para casa. Atravessar = pedir ao servidor.
const PORTAL = Object.freeze({ id: "portal-bairros", x: PORTAL_X, z: 0, radius: 4.5, nameKey: "centerHome" });

// Postes da calçada de fora do anel, nas curvas (longe de portas e travessias).
const STREET_LAMPS = Object.freeze([[24.6, 24.6], [-24.6, 24.6], [24.6, -24.6], [-24.6, -24.6], [-40, 5.6], [-47, -5.6]].map((p) => Object.freeze(p)));
// Árvores fora das quadras (colidem), sem tapar porta nem caminho.
const STREET_TREES = Object.freeze(
  [
    [-58, 20], [-58, 40], [-40, 46], [-20, 52], [0, 54], [40, 58], [58, 30], [58, 10], [58, -12],
    [58, -36], [58, -58], [20, -56], [0, -58], [-26, -56], [-44, -46], [-58, -44], [-38, 36],
  ].map(([x, z]) => Object.freeze([x, z, 1.1]))
);

// ═══ OBSTÁCULOS ═══ — a lista única (sala + predição do cliente).
function buildObstacles() {
  const boxes = [];
  const push = (x, z, hx, hz, rot, h, tag) => {
    const b = { x: round(x), z: round(z), hx: round(hx), hz: round(hz), rot: round(rot), h: round(h) };
    if (tag) b.place = tag;
    boxes.push(b);
  };
  // Prédios: a pegada inteira (o modelo detalhado nunca é colisor).
  for (const p of PLACES) {
    const { x0, x1, z0, z1 } = p.rect;
    push((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, p.size.h, p.id);
  }
  // Praça: monumento, floreiras, frades, bancos, postes, árvores.
  push(MONUMENT.x, MONUMENT.z, MONUMENT.radius * 0.88, MONUMENT.radius * 0.88, 0, MONUMENT.h);
  push(MONUMENT.x, MONUMENT.z, MONUMENT.radius * 0.88, MONUMENT.radius * 0.88, Math.PI / 4, MONUMENT.h);
  for (const p of PLAZA_EDGES.planters) push(p.x, p.z, p.hx, p.hz, p.rot, PLANTER.h);
  for (const [x, z] of PLAZA_EDGES.bollards) push(x, z, BOLLARD, BOLLARD, 0, 0.9);
  for (const [x, z, rot] of PLAZA_BENCHES) push(x, z, 1.05, 0.38, rot, 1);
  for (const [x, z] of PLAZA_LAMPS) push(x, z, 0.2, 0.2, 0, 3.6);
  for (const [x, z, s] of PLAZA_TREES) push(x, z, 0.35 * s, 0.35 * s, 0, 3.4 * s);
  for (const [x, z] of STREET_LAMPS) push(x, z, 0.2, 0.2, 0, 3.6);
  for (const [x, z, s] of STREET_TREES) push(x, z, 0.35 * s, 0.35 * s, 0, 3.4 * s);
  // Portal: dois pilares ladeando a avenida.
  for (const z of [-5.6, 5.6]) push(PORTAL_X - 1, z, 0.5, 0.5, 0, 6);
  // Cerca viva em volta, com o portão (fechado) atrás do portal.
  const hedge = (x, z, w, d) => push(x, z, w / 2, d / 2, 0, 1.5);
  const L = 2 * BOUND + 1;
  hedge(0, BOUND, L, 1);
  hedge(0, -BOUND, L, 1);
  hedge(BOUND, 0, 1, L);
  hedge(-BOUND, (BOUND + 6) / 2 + 0.25, 1, BOUND - 6 + 0.5);
  hedge(-BOUND, -(BOUND + 6) / 2 - 0.25, 1, BOUND - 6 + 0.5);
  push(-BOUND, 0, 0.5, 6.2, 0, 2.4); // portão do portal
  return boxes;
}
const OBSTACLES = Object.freeze(buildObstacles().map((b) => Object.freeze(b)));

/** Lugar seguro (dentro da cerca e fora de obstáculo). `resolveCircle` vem da regra de movimento. */
function isSafeSpot(x, z, resolveCircle, radius, obstacles = OBSTACLES) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (Math.abs(x) > BOUND - 0.5 - radius || Math.abs(z) > BOUND - 0.5 - radius) return false;
  const r = resolveCircle(x, z, radius, obstacles);
  return Math.hypot(r.x - x, r.z - z) < 1e-3;
}

/** A pista (asfalto) inclui este ponto? Anel com curvas arredondadas + avenida. */
function onRoad(x, z) {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const k = RING - CORNER_R; // 13: centro das curvas
  let d;
  if (ax <= k || az <= k) d = ax <= k ? Math.abs(az - RING) : Math.abs(ax - RING);
  else d = Math.abs(Math.hypot(ax - k, az - k) - CORNER_R);
  if (d <= ROAD_HALF && (ax <= RING + ROAD_HALF && az <= RING + ROAD_HALF)) return true;
  return x <= AVENUE.x0 && x >= AVENUE.x1 && Math.abs(z - AVENUE.z) <= AVENUE.half;
}

const DIMS = Object.freeze({
  plaza: PLAZA,
  ring: RING,
  roadHalf: ROAD_HALF,
  sidewalk: SIDEWALK,
  cornerR: CORNER_R,
  ringIn: RING_IN,
  ringOut: RING_OUT,
  outerWalk: OUTER_WALK,
  front: FRONT,
  bound: BOUND,
  avenue: AVENUE,
  portalX: PORTAL_X,
  planter: PLANTER,
  bollard: BOLLARD,
});

// Modelos publicados (gerado por MEU MUNDO 3D/pipeline/centro/publish.py, com
// hash no nome). Sem o arquivo, o cliente desenha os blocos de reserva.
const ASSETS_FILE = path.join(__dirname, "meuMundoCenterAssets.json");
function loadAssets() {
  try {
    const a = JSON.parse(fs.readFileSync(ASSETS_FILE, "utf8"));
    if (!a || typeof a.basePath !== "string" || !a.places) return null;
    const places = {};
    for (const p of PLACES) if (typeof a.places[p.id] === "string" && /^[a-z0-9._-]+\.glb$/i.test(a.places[p.id])) places[p.id] = a.places[p.id];
    return Object.freeze({ version: String(a.version || ""), basePath: a.basePath, places: Object.freeze(places) });
  } catch {
    return null;
  }
}
const ASSETS = loadAssets();

/** Payload do centro no contrato do cliente (o mesmo para todas as salas). */
function buildCenterPayload() {
  return {
    id: `centro-v${CENTER_VERSION}`,
    version: CENTER_VERSION,
    capacity: CENTER_CAPACITY,
    dims: DIMS,
    places: PLACES,
    plaza: {
      ...PLAZA_PLACE,
      monument: MONUMENT,
      trees: PLAZA_TREES,
      benches: PLAZA_BENCHES,
      lamps: PLAZA_LAMPS,
      flowers: PLAZA_FLOWERS,
      planters: PLAZA_EDGES.planters,
      bollards: PLAZA_EDGES.bollards,
    },
    crosswalks: CROSSWALKS,
    parking: PARKING,
    streetLamps: STREET_LAMPS,
    streetTrees: STREET_TREES,
    arrival: ARRIVAL,
    portal: PORTAL,
    obstacles: OBSTACLES,
    limit: LIMIT,
    assets: ASSETS,
  };
}

module.exports = {
  CENTER_VERSION,
  CENTER_CAPACITY,
  DIMS,
  PLACES,
  PLAZA_PLACE,
  OBSTACLES,
  LIMIT,
  ARRIVAL,
  ARRIVAL_SPOTS,
  PARKING,
  PORTAL,
  MONUMENT,
  isSafeSpot,
  onRoad,
  buildCenterPayload,
};
