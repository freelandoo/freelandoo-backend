// src/utils/meuMundoHospital.js
//
// MEU MUNDO 3D — o INTERIOR do hospital do centro (mm3d-26).
//
// Mesma régua das casas: a planta descreve só cômodos, aberturas e móveis; o
// montador (meuMundoInteriorKit.js) tira dela paredes, janelas, colisores,
// leitos (com o ponto de levantar) e limites. O cliente desenha com o
// interior.ts das casas e anda com a MESMA regra (interior-motion).
//
// O prédio por fora tem 20 × 14 m; por dentro, recepção na frente (com o
// consultório e a farmácia dos lados) e a enfermaria no fundo, com seis
// leitos — cada um com soro e monitor, biombos entre eles. Quem está
// INTERNADO (vida do hóspede, meuMundoLife.js) acorda num destes leitos.
//
// Coordenadas: x lateral, z para os fundos a partir da porta (z = 0), como
// nas casas. Móvel: [tipo, x, z, giro°, { w, d, h }]; frente local = −Z,
// 0 = virado para a rua, −90 = virado para +x.

const { buildInterior } = require("./meuMundoInteriorKit");

const R = (id, name, mat, x0, z0, x1, z1, extra = {}) => ({ id, name, mat, x0, z0, x1, z1, ...extra });
const D = (x, z, w = 1.1) => ({ x, z, w });

const HW = 9.6; // meia largura por dentro
const BACK = 13.4;
const SPLIT = 6; // recepção | enfermaria
const SIDE = 4.5; // recepção | consultório e farmácia

// Leitos da enfermaria, encostados na parede do fundo (cabeceira para o fundo).
const BED_X = [-8, -5, -2, 2, 5, 8];
const BED_Z = BACK - 0.08 - 1.05;

const ward = [];
for (const x of BED_X) {
  ward.push(["hbed", x, BED_Z, 0]);
  ward.push(["ivpole", x - 0.8, BACK - 0.5, 0]);
  ward.push(["monitor", x + 0.82, BACK - 0.32, 0]);
}
// Biombos entre os pares de leitos (o corredor do meio fica livre).
for (const x of [-6.5, -3.5, 3.5, 6.5]) ward.push(["screen", x, BACK - 1.0, 90]);

const PLAN = {
  level: 0,
  version: "hospital-v1",
  name: "Hospital",
  door: D(0, 0, 2.0),
  floors: [
    {
      rooms: [
        R("recepcao", "Recepção", "tile", -SIDE, 0, SIDE, SPLIT),
        R("consultorio", "Consultório", "tile", -HW, 0, -SIDE, SPLIT),
        R("farmacia", "Farmácia", "tile", SIDE, 0, HW, SPLIT),
        R("enfermaria", "Enfermaria", "tile", -HW, SPLIT, HW, BACK),
      ],
      doors: [D(-SIDE, 3.2, 1.1), D(SIDE, 3.2, 1.1), D(0, SPLIT, 2.6)],
      furniture: [
        // Recepção: balcão de frente para a porta, cadeiras de espera, plantas.
        ["reception", 2.2, 2.4, 0],
        ["chair", 2.2, 3.3, 180],
        ["chair", -4.0, 0.9, -90],
        ["chair", -4.0, 1.6, -90],
        ["chair", -4.0, 2.3, -90],
        ["plant", -3.9, 5.4, 0],
        ["plant", 3.9, 5.4, 0],
        // Consultório: mesa, cadeira do médico e do paciente, armário, maca.
        ["desk", -7.4, 1.5, 180],
        ["chair", -7.4, 2.35, 180],
        ["chair", -7.4, 0.7, 0],
        ["cabinet", -9.25, 3.2, -90],
        ["hbed", -6.6, 4.85, 90],
        // Farmácia: prateleiras na parede e o balcão.
        ["shelf", HW - 0.26, 1.2, 90],
        ["shelf", HW - 0.26, 2.5, 90],
        ["shelf", HW - 0.26, 3.8, 90],
        ["counter", 6.9, 4.9, 180, { w: 1.8 }],
        // Enfermaria.
        ...ward,
        ["cabinet", 0, BACK - 0.3, 0],
        ["plant", -HW + 0.4, SPLIT + 0.5, 0],
        ["plant", HW - 0.4, SPLIT + 0.5, 0],
      ],
    },
  ],
};

const HOSPITAL_INTERIOR = Object.freeze(buildInterior(PLAN));
// Leitos de internação = os da enfermaria (a maca do consultório não conta).
const WARD_BEDS = Object.freeze(HOSPITAL_INTERIOR.beds.filter((b) => b.z > SPLIT).map((b) => b.id));

/** Leito de um usuário: sempre o mesmo para a mesma pessoa (hash do id). */
function bedFor(idUser) {
  let h = 0;
  for (const ch of String(idUser)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return WARD_BEDS[h % WARD_BEDS.length];
}

module.exports = { HOSPITAL_INTERIOR, WARD_BEDS, bedFor };
