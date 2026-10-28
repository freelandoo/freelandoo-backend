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
const { HOSPITAL_INTERIOR } = require("./meuMundoHospital");
const { CENTER_INTERIORS } = require("./meuMundoCenterInteriors");

const CENTER_VERSION = 8; // sobe quando a planta muda: salas e posições de versões diferentes não se misturam (2 = hospital, mm3d-26; 3 = Paint, mm3d-35; 4 = praça aberta ao carro, mm3d-37f; 5 = Corrida antigravidade, mm3d-39; 6 = Rolê Noturno, mm3d-40; 7 = Arena de Boxe, mm3d-43; 8 = Gincana, mm3d-47)
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
  // Paint (mm3d-35): torre estreita no vão entre a academia e o jetpack, no eixo
  // da travessia sul (sai da praça e dá de frente com a porta). 0,4 m de folga
  // de cada lado: ninguém passa entre os prédios.
  { id: "paint", zone: "atividades", rect: [-1.6, 5.6, -FRONT - 14, -FRONT], h: 13, peak: 17, front: "n", door: 2, doorW: 2.4, game: "paint", party: 6 },
  // Corrida antigravidade (mm3d-39): hangar no canto nordeste, ao norte da
  // universidade, de frente para a curva nordeste do anel.
  { id: "corrida", zone: "atividades", rect: [FRONT, FRONT + 22, 19, 30], h: 8, peak: 14, front: "w", door: 24.5, doorW: 3.4, game: "corrida" },
  // Rolê Noturno (mm3d-40): skate shop no quarteirão noroeste, atrás da igreja,
  // de frente para o sul. Chega-se pelo corredor oeste (da avenida, entre a
  // igreja e a cerca) ou pela quina do anel entre a igreja e a pizzaria.
  { id: "noturno", zone: "atividades", rect: [-56, -36, 37, 51], h: 7, peak: 11, front: "s", door: -46, doorW: 3, game: "noturno" },
  // Arena de Boxe (mm3d-43): quarteirão atrás da hamburgueria e da pizzaria,
  // fachada LESTE para o corredor que sobe da praça entre a hamburgueria e o
  // supermercado (8 m de largura na altura da porta). A luva no telhado
  // aparece da praça por cima da hamburgueria.
  { id: "boxe", zone: "atividades", rect: [-30, -4, 44, 60], h: 9, peak: 15, front: "e", door: 52, doorW: 3.4, game: "boxe", party: 2 },
  // Gincana (mm3d-47): pavilhão inflável no fundo leste, atrás da biblioteca,
  // de frente para o OESTE. Chega-se pelo corredor entre a universidade (z ≥
  // −12) e a biblioteca (z ≤ −19), que sai da calçada do anel e dá de frente
  // com a porta (z −16). 2 m de folga dos dois prédios e da cerca.
  { id: "gincana", zone: "atividades", rect: [48, 62, -31, -13.5], h: 8, peak: 14, front: "w", door: -16, doorW: 3.4, game: "gincana", party: 8 },
  // Oeste — cívica (fachadas viradas para o leste, x = -FRONT), dos dois lados da avenida
  { id: "igreja", zone: "civica", rect: [-FRONT - 24, -FRONT, 12, 28], h: 9, peak: 19, front: "e", door: 20, doorW: 2.4 },
  { id: "delegacia", zone: "civica", rect: [-FRONT - 16, -FRONT, -28, -12], h: 7, peak: 9, front: "e", door: -20, doorW: 2.4 },
  // Canto sudoeste, entre a delegacia e a academia (mm3d-26): o hospital fica na
  // DIAGONAL, de frente para a praça. Prédio girado = `at` (meio da fachada),
  // `facing` (para onde a fachada olha), largura × fundo e a porta no X local.
  // Recuado para o eixo passar no meio do vão entre as quinas da delegacia
  // (−30, −28) e da academia (−22, −30): o corredor livre tem 6 m (|X| ≤ 3).
  { id: "hospital", zone: "civica", at: { x: -34.5, z: -37.5 }, facing: Math.PI / 4, width: 20, depth: 14, h: 7.6, peak: 10.4, doorX: 0, doorW: 2.6, interior: true },
];

/** Direção para FORA da fachada (de onde se chega à porta). */
const OUTWARD = Object.freeze({ n: { x: 0, z: 1 }, s: { x: 0, z: -1 }, e: { x: 1, z: 0 }, w: { x: -1, z: 0 } });

/** Quadro de um prédio de frente reta (n/s/e/w) a partir do retângulo. */
function straightFrame(def) {
  const [x0, x1, z0, z1] = def.rect;
  const out = OUTWARD[def.front];
  const door =
    def.front === "n" ? { x: def.door, z: z1 } : def.front === "s" ? { x: def.door, z: z0 } : def.front === "e" ? { x: x1, z: def.door } : { x: x0, z: def.door };
  const origin =
    def.front === "n" ? { x: (x0 + x1) / 2, z: z1 } : def.front === "s" ? { x: (x0 + x1) / 2, z: z0 } : def.front === "e" ? { x: x1, z: (z0 + z1) / 2 } : { x: x0, z: (z0 + z1) / 2 };
  const ns = def.front === "n" || def.front === "s";
  return { out, door, origin, rect: { x0, x1, z0, z1 }, frontW: ns ? x1 - x0 : z1 - z0, depth: ns ? z1 - z0 : x1 - x0, front: def.front };
}

/** Quadro de um prédio girado: `rect` vira a caixa que o envolve (só para conferência). */
function rotatedFrame(def) {
  const out = { x: Math.sin(def.facing), z: Math.cos(def.facing) };
  const rot = def.facing + Math.PI;
  const ax = { x: Math.cos(rot), z: -Math.sin(rot) };
  const origin = def.at;
  const door = { x: origin.x + ax.x * def.doorX, z: origin.z + ax.z * def.doorX };
  const xs = [];
  const zs = [];
  for (const l of [-def.width / 2, def.width / 2]) {
    for (const d of [0, def.depth]) {
      xs.push(origin.x + ax.x * l - out.x * d);
      zs.push(origin.z + ax.z * l - out.z * d);
    }
  }
  const rect = { x0: round(Math.min(...xs)), x1: round(Math.max(...xs)), z0: round(Math.min(...zs)), z1: round(Math.max(...zs)) };
  return { out, door, origin, rect, frontW: def.width, depth: def.depth, front: "rot" };
}

function buildPlace(def) {
  const { out, door, origin, rect, frontW, depth, front } = def.at ? rotatedFrame(def) : straightFrame(def);
  const { x0, x1, z0, z1 } = rect;
  const facingOut = round(Math.atan2(out.x, out.z));
  // Origem do MODELO: meio da fachada, no chão. O modelo é feito com a frente
  // no -Z local e o corpo para o +Z; a rotação o leva ao lugar.
  const rot = Math.atan2(out.x, out.z) + Math.PI;
  // Eixo X local no mundo (mesma convenção do Babylon): a porta no quadro do modelo.
  const ax = { x: Math.cos(rot), z: -Math.sin(rot) };
  const doorLocalX = (door.x - origin.x) * ax.x + (door.z - origin.z) * ax.z;
  const facingIn = round(Math.atan2(-out.x, -out.z));
  const at = (d) => ({ x: round(door.x + out.x * d), z: round(door.z + out.z * d) });
  return Object.freeze({
    id: def.id,
    zone: def.zone,
    // Nome: a chave de tradução; o texto mora nos dicionários do cliente.
    nameKey: `centerPlace_${def.id}`,
    rect: Object.freeze({ x0, x1, z0, z1 }),
    size: Object.freeze({ w: round(x1 - x0), d: round(z1 - z0), h: def.h, peak: def.peak }),
    center: Object.freeze({ x: round(origin.x - (out.x * depth) / 2), z: round(origin.z - (out.z * depth) / 2) }),
    // n/s/e/w ou "rot" (prédio girado: a colisão é a pegada girada, não `rect`).
    front,
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
    // Destino: minijogo (game:<id>, mm3d-20) ou interior (interior:<id>). Só
    // abrem os que existem: os minijogos e o hospital (mm3d-26, INTERIORS).
    destination: def.game ? `game:${def.game}` : `interior:${def.id}`,
    available: !!def.game || !!def.interior || !!CENTER_INTERIORS[def.id],
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

// Floreiras na borda da praça (meia-largura 0,45, altura 0,6). Desde o
// mm3d-37f a travessia é ABERTA (sem frade): o carro (1,96 m) passa pelo vão
// de 3,8 m — e dirigir na praça é crime (multa; reincidência, prisão), pedido
// do Alex. Nas curvas, uma floreira diagonal fecha o canto.
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

// ═══ HOSPITAL (mm3d-26) ═══ — pátio, baia da ambulância e o caminho até o anel.
// Medidas no quadro do hospital: X = lateral da fachada (o X local do modelo),
// D = metros para FORA da fachada. O corredor entre as quinas da delegacia e
// da academia é |X| ≤ 3 (ver PLACE_DEFS): pista da ambulância de um lado,
// calçada do outro, e os dois chegam à curva sudoeste do anel.
const HOSPITAL = PLACES.find((p) => p.id === "hospital");
function hospitalAt(X, D) {
  const r = HOSPITAL.rotationY;
  const f = r - Math.PI;
  return { x: round(HOSPITAL.origin.x + Math.cos(r) * X + Math.sin(f) * D), z: round(HOSPITAL.origin.z - Math.sin(r) * X + Math.cos(f) * D) };
}
/** Placa de chão girada com o hospital: X de x0 a x1, D de d0 a d1. */
function hospitalPad(kind, x0, x1, d0, d1) {
  return Object.freeze({ kind, ...hospitalAt((x0 + x1) / 2, (d0 + d1) / 2), w: round(x1 - x0), d: round(d1 - d0), rot: HOSPITAL.rotationY });
}
// kind: pave (pátio) · asphalt (pista; por cima da calçada do anel = rebaixo) · walk (calçada) · mark (faixa amarela da baia).
const GROUNDS = Object.freeze([
  hospitalPad("pave", -9, 7, 0, 7),
  hospitalPad("asphalt", -7.6, -3.4, 0.3, 7),
  hospitalPad("asphalt", -3, 0.3, 6, 21.5),
  hospitalPad("walk", 0.5, 3, 6.5, 19),
  hospitalPad("mark", -7.6, -7.4, 0.3, 7),
  hospitalPad("mark", -3.6, -3.4, 0.3, 7),
]);
// Ambulância estacionada na baia, de bico para a praça (pronta para sair).
const AMBULANCE = Object.freeze({ id: "ambulancia", ...hospitalAt(-5.5, 3.7), facing: round(HOSPITAL.rotationY - Math.PI), half: Object.freeze({ x: 1.08, z: 2.8 }), h: 2.9 });
const PROPS = Object.freeze([AMBULANCE]);
// Pilares da marquise (no modelo: X ±2,1, 1,7 a 2,1 m da fachada).
const HOSPITAL_PILLARS = Object.freeze([-2.1, 2.1].map((X) => Object.freeze(hospitalAt(X, 1.9))));

// Postes da calçada de fora do anel, nas curvas (longe de portas e travessias).
// A curva sudoeste perdeu o seu (ficava no meio da calçada do hospital): os
// três do caminho do hospital fazem a vez.
const HOSPITAL_LAMPS = [hospitalAt(3.4, 12), hospitalAt(-3.3, 12), hospitalAt(3.4, 16.5)].map((p) => [p.x, p.z]);
const STREET_LAMPS = Object.freeze([[24.6, 24.6], [-24.6, 24.6], [24.6, -24.6], [-40, 5.6], [-47, -5.6], ...HOSPITAL_LAMPS].map((p) => Object.freeze(p)));
// Árvores fora das quadras (colidem), sem tapar porta nem caminho. (A de
// [−44, −46] saiu: é o miolo do hospital. mm3d-40: [−40, 46] e [−38, 36]
// foram para [−30, 50] e [−60, 30] — o Rolê Noturno ocupa aquele canto.
// mm3d-43: [−30, 50], [−20, 52] e [0, 54] (a arena e a frente da porta dela)
// foram para [−33, 61], [12, 60] e [5, 62].)
const STREET_TREES = Object.freeze(
  [
    [-58, 20], [-58, 40], [-33, 61], [12, 60], [5, 62], [40, 58], [58, 30], [58, 10], [58, -12],
    [58, -36], [58, -58], [20, -56], [0, -58], [-26, -56], [-58, -44], [-60, 30],
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
    if (p.front === "rot") {
      push(p.center.x, p.center.z, p.model.width / 2, p.model.depth / 2, p.rotationY, p.size.h, p.id);
      continue;
    }
    const { x0, x1, z0, z1 } = p.rect;
    push((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, p.size.h, p.id);
  }
  // Objetos parados (ambulância): caixa girada pelo rumo.
  for (const o of PROPS) push(o.x, o.z, o.half.x, o.half.z, o.facing, o.h);
  for (const p of HOSPITAL_PILLARS) push(p.x, p.z, 0.22, 0.22, HOSPITAL.rotationY, 2.5);
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
    const ok = (v) => typeof v === "string" && /^[a-z0-9._-]+\.glb$/i.test(v);
    for (const p of PLACES) if (ok(a.places[p.id])) places[p.id] = a.places[p.id];
    const props = {};
    for (const o of PROPS) if (a.props && ok(a.props[o.id])) props[o.id] = a.props[o.id];
    return Object.freeze({ version: String(a.version || ""), basePath: a.basePath, places: Object.freeze(places), props: Object.freeze(props) });
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
    grounds: GROUNDS,
    props: PROPS,
    // Interiores que abrem (destino interior:<id>): a mesma planta para todos.
    // O hospital vem aqui (mm3d-26); os outros prédios (mm3d-37) são buscados
    // ao entrar (GET /center/interiors/:id) para o payload continuar pequeno.
    interiors: { hospital: HOSPITAL_INTERIOR },
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
  GROUNDS,
  PROPS,
  isSafeSpot,
  onRoad,
  buildCenterPayload,
};
