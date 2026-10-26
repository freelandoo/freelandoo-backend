// src/utils/meuMundoCenterInteriors.js
//
// MEU MUNDO 3D — o CENTRO POR DENTRO (mm3d-37). As plantas dos prédios do
// centro, na mesma régua das casas e do hospital (meuMundoInteriorKit.js): a
// planta descreve cômodos, aberturas, móveis e NPCs; o montador tira paredes,
// janelas, colisores, assentos, pontos de uso e limites. O cliente desenha
// com interior.ts e anda com interior-motion (sem sala multiplayer: o que
// vale moeda ou atributo é decidido pela vida, no servidor).
//
// Coordenadas: x lateral, z para os fundos a partir da porta (z = 0). Móvel:
// [tipo, x, z, giro°, extras]; frente local = −Z; 0 = virado para a porta,
// 180 = para os fundos, −90 = para +x, 90 = para −x. Extras: `use` (o que se
// faz ali), `npc` (assento ocupado por um NPC), medidas (w/d/h).
//
// Medidas por dentro = a do modelo por fora menos as paredes (0,4 m de cada
// lado, 0,6 m no fundo), como o hospital.

const { buildInterior } = require("./meuMundoInteriorKit");

const R = (id, name, mat, x0, z0, x1, z1, extra = {}) => ({ id, name, mat, x0, z0, x1, z1, ...extra });
const D = (x, z, w = 1.1) => ({ x, z, w });

/** Mesa de dois com uma cadeira de cada lado (em x). */
function cafeTable(x, z) {
  return [
    ["table2", x, z, 0],
    ["chair", x - 0.68, z, -90],
    ["chair", x + 0.68, z, 90],
  ];
}

/**
 * Fileira de estudo: mesa comprida (table6) com três cadeiras viradas para
 * os fundos (+z), a mesa à frente delas. `chairZ` = a linha das cadeiras.
 */
function studyRow(x, chairZ, use = "study") {
  const out = [["table6", x, chairZ + 0.74, 0]];
  for (const dx of [-0.6, 0, 0.6]) out.push(["chair", x + dx, chairZ, 180, { use }]);
  return out;
}

/** Mesa de leitura com três cadeiras de cada lado (biblioteca). */
function readingTable(x, z) {
  const out = [["table6", x, z, 0]];
  for (const dx of [-0.6, 0, 0.6]) {
    out.push(["chair", x + dx, z + 0.74, 0, { use: "study" }]);
    out.push(["chair", x + dx, z - 0.74, 180, { use: "study" }]);
  }
  return out;
}

/** Carteira de escola: mesinha e a cadeira atrás, virada para o quadro (+z). */
function schoolDesk(x, chairZ) {
  return [
    ["desk", x, chairZ + 0.6, 180],
    ["chair", x, chairZ, 180, { use: "study" }],
  ];
}

// ═══ PIZZARIA (13 × 12) ═════════════════════════════════════════════════════
function pizzaria() {
  const HW = 6.1;
  const BACK = 11.4;
  const SPLIT = 7.8;
  return {
    level: 0,
    version: "centro-pizzaria-v1",
    name: "Pizzaria",
    theme: "pizzaria",
    door: D(0, 0, 1.6),
    floors: [
      {
        rooms: [R("salao", "Salão", "wood", -HW, 0, HW, SPLIT), R("cozinha", "Cozinha", "tile", -HW, SPLIT, HW, BACK)],
        open: [["salao", "cozinha"]],
        furniture: [
          // Balcão de ponta a ponta: o caixa no meio, a cozinha atrás.
          ["counter", -3.8, 7.45, 0, { w: 4.6, d: 0.7, h: 1.05 }],
          ["order_counter", 0, 7.45, 0],
          ["counter", 3.8, 7.45, 0, { w: 4.6, d: 0.7, h: 1.05 }],
          ["pizza_oven", -3.2, 10.6, 0],
          ["counter", 2.6, 11.0, 0, { w: 2.4 }],
          ["menu_board", 2.6, 11.28, 0],
          ...cafeTable(-4.3, 2.0),
          ...cafeTable(-4.3, 4.9),
          ...cafeTable(4.3, 2.0),
          ...cafeTable(4.3, 4.9),
          ["plant", -5.6, 6.5, 0],
          ["plant", 5.6, 6.5, 0],
          ["lamp", -1.7, 0.6, 0],
          ["lamp", 1.7, 0.6, 0],
        ],
      },
    ],
    npcs: [{ role: "pizzaiolo", x: 0, z: 8.6, r: 0 }],
  };
}

// ═══ HAMBURGUERIA (13 × 12) ═════════════════════════════════════════════════
function hamburgueria() {
  const HW = 6.1;
  const BACK = 11.4;
  const SPLIT = 7.8;
  /** Par de bancos estofados de frente um para o outro, a mesa no meio. */
  const boothPair = (z) => [
    ["booth", -5.45, z, -90],
    ["table2", -4.52, z, 0, { w: 0.8, d: 1.2 }],
    ["booth", -3.59, z, 90],
  ];
  return {
    level: 0,
    version: "centro-hamburgueria-v1",
    name: "Hamburgueria",
    theme: "hamburgueria",
    door: D(0, 0, 1.6),
    floors: [
      {
        rooms: [R("salao", "Salão", "tile", -HW, 0, HW, SPLIT), R("cozinha", "Cozinha", "tile", -HW, SPLIT, HW, BACK)],
        open: [["salao", "cozinha"]],
        furniture: [
          ["counter", -3.05, 7.45, 0, { w: 6.1, d: 0.7, h: 1.05 }],
          ["order_counter", 1.5, 7.45, 0],
          ["counter", 4.55, 7.45, 0, { w: 3.1, d: 0.7, h: 1.05 }],
          ["stove", -2.2, 11.0, 0, { w: 1.6 }],
          ["fryer", -0.6, 11.0, 0],
          ["counter", 2.6, 11.0, 0, { w: 2.4 }],
          ["menu_board", -4.4, 11.28, 0],
          ["soda_machine", 5.45, 6.3, 0],
          ...boothPair(2.2),
          ...boothPair(5.2),
          ...cafeTable(3.6, 2.2),
          ...cafeTable(3.6, 4.9),
          ["plant", 5.6, 0.6, 0],
        ],
      },
    ],
    npcs: [{ role: "atendente", x: 1.5, z: 8.4, r: 0 }],
  };
}

// ═══ SUPERMERCADO (26 × 20) + sala do vendedor ══════════════════════════════
function supermercado() {
  const HW = 12.6;
  const BACK = 19.4;
  const SX = -6.6; // loja | ala do vendedor e corredor do fundo
  const SZ = 6.5; // sala do vendedor | fundo
  const gondolas = [];
  for (const x of [-4.5, -1.0, 2.5, 6.0, 9.5]) for (const z of [9.2, 13.4]) gondolas.push(["gondola", x, z, 90]);
  const cases = [];
  for (const x of [-4.0, -1.3, 1.4, 4.1, 6.8, 9.5]) cases.push(["fridge_case", x, 18.92, 0]);
  return {
    level: 0,
    version: "centro-supermercado-v1",
    name: "Supermercado",
    theme: "supermercado",
    door: D(0, 0, 3.4),
    floors: [
      {
        rooms: [
          R("loja", "Loja", "tile", SX, 0, HW, BACK),
          R("fundo", "Corredor do fundo", "tile", -HW, SZ, SX, BACK),
          R("vendedor", "Imóveis e Veículos", "carpet", -HW, 0, SX, SZ),
        ],
        open: [["loja", "fundo"]],
        doors: [D(SX, 4.6, 1.2)],
        furniture: [
          // Caixas perto da entrada (o cliente paga de frente, o operador atrás).
          ["checkout", 4.0, 4.0, 0],
          ["checkout", 8.0, 4.0, 0],
          ["fruit_stand", -3.6, 2.9, 0],
          ["fruit_stand", -3.6, 5.1, 0],
          ...gondolas,
          ...cases,
          ["gondola", -9.6, 10.6, 90],
          ["gondola", -9.6, 14.6, 90],
          ["fridge_case", -12.12, 10.2, -90],
          ["fridge_case", -12.12, 14.2, -90],
          ["plant", 12.0, 0.6, 0],
          // Sala do vendedor: mesa, ele sentado do lado da parede, o cliente de frente.
          ["desk", -10.4, 3.2, -90],
          ["chair", -11.2, 3.2, -90, { npc: "vendedor" }],
          ["chair", -9.55, 3.2, 90, { use: "seller" }],
          ["poster", -9.6, 0.13, 180],
          ["poster", -12.49, 3.2, -90],
          ["shelf", -12.3, 5.6, -90],
          ["plant", -7.2, 0.6, 0],
          ["armchair", -7.25, 2.0, 90],
        ],
      },
    ],
    npcs: [
      { role: "caixa", x: 4.0, z: 4.85, r: 0 },
      { role: "caixa", x: 8.0, z: 4.85, r: 0 },
    ],
  };
}

// ═══ UNIVERSIDADE (28 × 22) ═════════════════════════════════════════════════
function universidade() {
  const HW = 13.6;
  const BACK = 21.4;
  const HALL = 7;
  const room = (cx, rows) => {
    const out = [
      ["blackboard", cx, BACK - 0.13, 0],
      ["lectern", cx, 19.6, 0],
    ];
    for (const z of rows) {
      out.push(...studyRow(cx - 3.2, z));
      out.push(...studyRow(cx + 2.4, z));
    }
    return out;
  };
  return {
    level: 0,
    version: "centro-universidade-v1",
    name: "Universidade",
    theme: "universidade",
    door: D(0, 0, 3.0),
    floors: [
      {
        rooms: [
          R("hall", "Hall", "stone", -HW, 0, HW, HALL),
          R("salaA", "Sala de aula A", "wood", -HW, HALL, 0, BACK),
          R("salaB", "Sala de aula B", "wood", 0, HALL, HW, BACK),
        ],
        doors: [D(-6.8, HALL, 1.4), D(6.8, HALL, 1.4)],
        furniture: [
          ["reception", -9.0, 4.4, 0],
          ["sofa3", 13.07, 3.5, 90],
          ["plant", -13.0, 0.6, 0],
          ["plant", 13.0, 0.6, 0],
          ["poster", -4.0, HALL - 0.11, 0],
          ["poster", 4.0, HALL - 0.11, 0],
          ...room(-6.8, [9.0, 11.6, 14.2, 16.8]),
          ...room(6.8, [9.6, 12.2, 14.8]),
          ["bookcase", 13.18, 17.0, 90],
        ],
      },
    ],
    npcs: [
      { role: "secretaria", x: -9.0, z: 5.25, r: 0 },
      { role: "professor", x: -5.6, z: 19.9, r: 0 },
    ],
  };
}

// ═══ BIBLIOTECA (14 × 16) ═══════════════════════════════════════════════════
function biblioteca() {
  const HW = 6.6;
  const BACK = 15.4;
  const shelves = [];
  for (const z of [5.5, 7.4, 9.3, 11.2, 13.1]) shelves.push(["bookcase", -6.31, z, -90]);
  for (const z of [1.8, 3.7, 5.6, 7.5, 9.4, 11.3, 13.2]) shelves.push(["bookcase", 6.31, z, 90]);
  for (const x of [-3.8, -1.9, 0, 1.9, 3.8]) shelves.push(["bookcase", x, BACK - 0.29, 0]);
  return {
    level: 0,
    version: "centro-biblioteca-v1",
    name: "Biblioteca",
    theme: "biblioteca",
    door: D(0, 0, 2.0),
    floors: [
      {
        rooms: [R("salao", "Salão de leitura", "carpet", -HW, 0, HW, BACK)],
        furniture: [
          ["reception", -4.2, 2.6, 0],
          ...shelves,
          ...readingTable(-2.2, 7.6),
          ...readingTable(2.2, 7.6),
          ...readingTable(-2.2, 11.4),
          ...readingTable(2.2, 11.4),
          ["lamp", -0.9, 5.2, 0],
          ["lamp", 0.9, 13.6, 0],
          ["plant", -6.0, 0.6, 0],
        ],
      },
    ],
    npcs: [{ role: "bibliotecaria", x: -4.2, z: 3.45, r: 0 }],
  };
}

// ═══ ESCOLA (16 × 16) ═══════════════════════════════════════════════════════
function escola() {
  const HW = 7.6;
  const BACK = 15.4;
  const HALL = 5;
  const desks = [];
  for (const x of [-4.6, 0, 4.6]) for (const z of [7.0, 9.6, 12.2]) desks.push(...schoolDesk(x, z));
  return {
    level: 0,
    version: "centro-escola-v1",
    name: "Escola",
    theme: "escola",
    door: D(0, 0, 2.0),
    floors: [
      {
        rooms: [R("entrada", "Entrada", "tile", -HW, 0, HW, HALL), R("sala", "Sala de aula", "wood", -HW, HALL, HW, BACK)],
        doors: [D(0, HALL, 1.4)],
        furniture: [
          ["lockers", -7.27, 1.6, -90],
          ["lockers", -7.27, 3.2, -90],
          ["lockers", 7.27, 1.6, 90],
          ["lockers", 7.27, 3.2, 90],
          ["poster", -3.5, HALL - 0.11, 0],
          ["poster", 3.5, HALL - 0.11, 0],
          ["blackboard", 0, BACK - 0.13, 0],
          ["desk", 3.2, 13.95, 0],
          ...desks,
          ["bookcase", -7.39, 13.6, -90],
          ["plant", 7.0, 5.6, 0],
        ],
      },
    ],
    npcs: [{ role: "professora", x: -1.9, z: 14.3, r: 0 }],
  };
}

// ═══ ACADEMIA (20 × 16) ═════════════════════════════════════════════════════
function academia() {
  const HW = 9.6;
  const BACK = 15.4;
  return {
    level: 0,
    version: "centro-academia-v1",
    name: "Academia",
    theme: "academia",
    door: D(0, 0, 2.8),
    floors: [
      {
        rooms: [R("salao", "Academia", "rubber", -HW, 0, HW, BACK)],
        furniture: [
          ["reception", -6.5, 3.0, 0],
          ["lockers", -9.27, 6.2, -90],
          ["lockers", -9.27, 7.7, -90],
          // Esteiras viradas para o fundo; quem corre fica em cima.
          ["treadmill", 4.2, 13.8, 180],
          ["treadmill", 5.7, 13.8, 180],
          ["treadmill", 7.2, 13.8, 180],
          ["treadmill", 8.7, 13.8, 180],
          ["squat_rack", -7.6, 13.9, 0],
          ["squat_rack", -4.6, 13.9, 0],
          ["punching_bag", -8.5, 10.4, -90],
          ["punching_bag", -6.8, 10.4, -90],
          ["plyo_box", -1.6, 9.4, 0],
          ["plyo_box", 0.2, 9.4, 0],
          ["gym_mat", 1.6, 6.6, 0],
          ["gym_mat", 3.1, 6.6, 0],
          ["gym_mat", 4.6, 6.6, 0],
          ["kettlebells", 6.9, 6.6, 0],
          ["dumbbell_rack", 9.0, 9.6, 90],
          ["mirror", 9.49, 9.6, 90],
          ["weight_bench", 7.6, 9.6, 90],
          ["plant", 9.0, 0.6, 0],
          ["plant", -2.4, 0.6, 0],
        ],
      },
    ],
    npcs: [
      { role: "recepcionista", x: -6.5, z: 3.85, r: 0 },
      { role: "personal", x: -2.8, z: 12.2, r: 0 },
    ],
  };
}

// ═══ IGREJA (16 × 24) ═══════════════════════════════════════════════════════
function igreja() {
  const HW = 7.6;
  const BACK = 23.4;
  const pews = [];
  for (const z of [4.0, 5.75, 7.5, 9.25, 11.0, 12.75, 14.5]) for (const x of [-5.25, -2.45, 2.45, 5.25]) pews.push(["pew", x, z, 180]);
  return {
    level: 0,
    version: "centro-igreja-v1",
    name: "Igreja",
    theme: "igreja",
    door: D(0, 0, 2.0),
    floors: [
      {
        rooms: [R("nave", "Nave", "stone", -HW, 0, HW, BACK)],
        furniture: [
          ["rug", 0, 9.6, 0, { w: 1.4, d: 16.4 }],
          ...pews,
          ["altar", 0, 19.8, 0],
          ["cross", 0, BACK - 0.14, 0],
          ["candles", -1.6, 19.8, 0],
          ["candles", 1.6, 19.8, 0],
          ["lectern", -2.8, 18.6, 0],
          ["plant", -3.6, 21.6, 0],
          ["plant", 3.6, 21.6, 0],
          ["piano", 7.2, 20.6, 90],
        ],
      },
    ],
    npcs: [{ role: "padre", x: 0, z: 20.95, r: 0 }],
  };
}

// ═══ DELEGACIA (16 × 16) — recepção, corredor e duas celas ══════════════════
function delegacia() {
  const HW = 7.6;
  const BACK = 15.4;
  const LOBBY = 7;
  const HALLZ = 10;
  return {
    level: 0,
    version: "centro-delegacia-v1",
    name: "Delegacia",
    theme: "delegacia",
    door: D(0, 0, 2.0),
    floors: [
      {
        rooms: [
          R("recepcao", "Recepção", "tile", -HW, 0, HW, LOBBY),
          R("corredor", "Corredor", "tile", -HW, LOBBY, HW, HALLZ),
          R("cela1", "Cela 1", "stone", -HW, HALLZ, -2.6, BACK, { cell: true }),
          R("cela2", "Cela 2", "stone", -2.6, HALLZ, 2.4, BACK, { cell: true }),
          R("arquivo", "Arquivo", "tile", 2.4, HALLZ, HW, BACK),
        ],
        // As celas não têm parede para o corredor: a grade (sólida) fecha.
        open: [["corredor", "cela1"], ["corredor", "cela2"]],
        doors: [D(-4.0, LOBBY, 1.4), D(5.0, HALLZ, 1.1)],
        furniture: [
          ["reception", 0, 4.8, 0, { use: "police" }],
          ["chair", -7.27, 1.5, -90],
          ["chair", -7.27, 2.2, -90],
          ["chair", -7.27, 2.9, -90],
          ["desk", 5.6, 2.6, -90],
          ["chair", 6.4, 2.6, -90, { npc: "policial" }],
          ["flag", 6.9, 6.3, 0],
          ["plant", -6.9, 6.3, 0],
          ["bars", -5.1, HALLZ, 0, { w: 5.0 }],
          ["bars", -0.1, HALLZ, 0, { w: 5.0 }],
          ["cot", -6.9, 14.35, 0],
          ["toilet", -3.3, 14.99, 0],
          ["cot", -1.9, 14.35, 0],
          ["toilet", 1.6, 14.99, 0],
          ["cabinet", 4.0, 15.07, 0],
          ["cabinet", 5.2, 15.07, 0],
          ["shelf", 7.34, 12.6, 90],
          ["lockers", -7.27, 8.5, -90],
        ],
      },
    ],
    npcs: [{ role: "delegado", x: 0, z: 5.65, r: 0 }],
  };
}

const PLANS = { pizzaria, hamburgueria, supermercado, universidade, biblioteca, escola, academia, igreja, delegacia };

const CENTER_INTERIORS = Object.freeze(Object.fromEntries(Object.entries(PLANS).map(([id, f]) => [id, Object.freeze(buildInterior(f()))])));

// Celas da delegacia (mm3d-37f): a cama de quem está preso.
const JAIL_BEDS = Object.freeze(CENTER_INTERIORS.delegacia.beds.map((b) => b.id));

module.exports = { CENTER_INTERIORS, JAIL_BEDS, PLANS };
