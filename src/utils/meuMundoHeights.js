// src/utils/meuMundoHeights.js
//
// MEU MUNDO 3D — altura de cada corpo (chão → topo da cabeça) e a PASSADA que
// sai dela. Espelho de features/meu-mundo/heights.ts do frontend (o teste
// test/unit/meuMundoPace.test.js confere a tabela).
//
// Pedido do Alex (2026-11-02): personagem maior tem perna maior e tem que
// percorrer MAIS chão no mesmo tempo — a velocidade a pé cresce com a altura
// (1,8 m = a de sempre; menor que isso não fica mais lento).

const HEIGHT = Object.freeze({
  raposa: 1.7,
  vampiro: 1.7,
  raposa_f: 1.65,
  vampira: 1.65,
  raposa_adulto: 2.7,
  vampiro_adulto: 2.7,
  raposa_adulta: 2.7,
  vampira_adulta: 2.7,
  aurion: 3.2,
  morkhan: 3.2,
  kragor: 3.2,
  zephyra: 3.2,
  maru: 3.2,
  iris: 3.2,
  noctis: 3.2,
  aeryn: 3.2,
  ciborgue: 4.0,
  cavaleiro: 2.0,
  golem: 4.0,
  garras: 2.0,
  brutamontes: 4.0,
});

/** Altura de referência das velocidades de MOTION (os avatares do bairro). */
const BASE_HEIGHT = 1.8;

function bodyHeight(body) {
  return HEIGHT[body] ?? BASE_HEIGHT;
}

/** Multiplicador da velocidade a pé pelo tamanho do corpo (≥ 1). */
function bodyStride(body) {
  return Math.max(1, bodyHeight(body) / BASE_HEIGHT);
}

module.exports = { HEIGHT, BASE_HEIGHT, bodyHeight, bodyStride };
