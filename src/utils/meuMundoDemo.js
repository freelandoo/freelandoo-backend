// src/utils/meuMundoDemo.js
//
// MEU MUNDO 3D — o bairro DEMONSTRATIVO da área administrativa.
//
// Isto é o "adaptador de dados demonstrativos": o contrato (Neighborhood →
// Lot → House) é o que o servidor vai devolver quando o bairro for persistido
// de verdade, e o cliente já lê exatamente esta forma. Trocar a fonte é trocar
// esta função por uma consulta — o cliente não muda.
//
// Regras desta etapa (não regredir antes da entrega do bairro persistente):
//  - Nada aqui é propriedade de ninguém. `ownerId` é sempre null: o bairro é
//    demonstração e não atribui casa, não mexe em saldo, não cria registro.
//  - Não existem "moradores online" — o cliente não pode apresentar vizinho
//    fictício como usuário real.
//  - Os identificadores são ESTÁVEIS (bairro, lote e casa): é por eles que a
//    entrega persistente vai casar o que hoje é demonstração.
//
// Geometria NÃO mora aqui. O servidor diz ONDE fica cada lote e para onde ele
// está virado; ruas, praça e casas são desenhadas pelo cliente a partir do
// `layout` (hoje só "ring-20": um anel de ruas com quatro quadras de cinco).

const MEU_MUNDO_RELEASE = "mm3d-01";

const LOT_WIDTH = 9; // frente do lote, em metros
const LOT_DEPTH = 12; // fundo do lote
const RING = 26; // eixo da rua em anel (meia-aresta do quadrado)
const ROAD_HALF = 3;
const SIDEWALK = 2;
// Centro dos lotes: depois da rua e da calçada de fora, mais meio fundo.
const LOT_CENTER = RING + ROAD_HALF + SIDEWALK + LOT_DEPTH / 2; // 37

// Cinco posições ao longo de cada lado, centradas no eixo.
const SLOTS = [-2, -1, 0, 1, 2].map((i) => i * LOT_WIDTH);

// A FRENTE da casa é o -Z local; a rotação vira a frente para a rua.
// Quadras em sentido horário a partir do noroeste — a numeração 01–20 segue.
const GROUPS = [
  { side: "north", rotationY: 0, at: (s) => ({ x: s, z: LOT_CENTER }) },
  { side: "east", rotationY: Math.PI / 2, at: (s) => ({ x: LOT_CENTER, z: -s }) },
  { side: "south", rotationY: Math.PI, at: (s) => ({ x: -s, z: -LOT_CENTER }) },
  { side: "west", rotationY: -Math.PI / 2, at: (s) => ({ x: -LOT_CENTER, z: s }) },
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function buildDemoNeighborhood() {
  const lots = [];
  const houses = [];
  let n = 0;
  for (const group of GROUPS) {
    for (const s of SLOTS) {
      n += 1;
      const num = pad2(n);
      const { x, z } = group.at(s);
      lots.push({
        id: `lot-${num}`,
        number: n,
        side: group.side,
        position: { x, z },
        rotationY: group.rotationY,
        width: LOT_WIDTH,
        depth: LOT_DEPTH,
        houseId: `house-${num}`,
      });
      houses.push({
        id: `house-${num}`,
        lotId: `lot-${num}`,
        level: 1,
        // Variação visual estável por casa (cores e detalhes), nunca sorteada
        // a cada carga: a mesma casa tem que parecer a mesma em toda visita.
        variant: (n * 7) % 12,
        ownerId: null,
      });
    }
  }

  return {
    release: MEU_MUNDO_RELEASE,
    demo: true,
    neighborhood: {
      id: "bairro-demo-01",
      name: "Bairro Inicial",
      layout: "ring-20",
      capacity: 20,
      lots,
      houses,
      spawn: { x: 0, z: -15, rotationY: 0 },
      exit: { id: "exit-centro", x: 52, z: RING, label: "Centro da cidade" },
    },
  };
}

module.exports = { buildDemoNeighborhood, MEU_MUNDO_RELEASE };
