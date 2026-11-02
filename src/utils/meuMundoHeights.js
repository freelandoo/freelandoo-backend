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

/** Altura do MODELO (o GLB nasce assim; a cena escala para a altura de agora). */
function bodyHeight(body) {
  return HEIGHT[body] ?? BASE_HEIGHT;
}

/**
 * CRESCER (regra do Alex, 2026-11-02): as classes não nascem do tamanho final.
 *  • Jovem: 1,40 m no 1º dia → a altura dele (1,70 menino / 1,65 menina) com
 *    1 mês de jogo (YOUNG_DAYS), em linha reta pela idade.
 *  • Adulto: 1,80 m no dia em que vira adulto → 2,40 m (TODOS os adultos) em
 *    mais 1 mês (ADULT_DAYS).
 * Quando vira adulto é da vida (meuMundoLife.js GROWTH: idade + força +
 * inteligência). Os outros corpos (skins, deuses, padrão) ficam na altura do modelo.
 */
const GROW = Object.freeze({ YOUNG_FROM: 1.4, YOUNG_DAYS: 30, ADULT_FROM: 1.8, ADULT_TO: 2.4, ADULT_DAYS: 30 });
const YOUNG = new Set(["raposa", "vampiro", "raposa_f", "vampira"]);
const ADULT = new Set(["raposa_adulto", "vampiro_adulto", "raposa_adulta", "vampira_adulta"]);
const DAY_MS = 86400000;
const at01 = (v) => Math.min(1, Math.max(0, v));
const ms = (v) => (typeof v === "number" ? v : v ? Date.parse(v) : NaN);

/** Altura de agora (m, 2 casas) pelo corpo e pelo crescimento da vida ({ from, at } em ms ou ISO). */
function grownHeight(body, growth, t = Date.now()) {
  const from = ms(growth && growth.from);
  const at = ms(growth && growth.at);
  if (YOUNG.has(body)) {
    const k = from > 0 ? at01((t - from) / (GROW.YOUNG_DAYS * DAY_MS)) : 1;
    return Math.round((GROW.YOUNG_FROM + (bodyHeight(body) - GROW.YOUNG_FROM) * k) * 100) / 100;
  }
  if (ADULT.has(body)) {
    const k = at > 0 ? at01((t - at) / (GROW.ADULT_DAYS * DAY_MS)) : 1;
    return Math.round((GROW.ADULT_FROM + (GROW.ADULT_TO - GROW.ADULT_FROM) * k) * 100) / 100;
  }
  return bodyHeight(body);
}

/** Multiplicador da velocidade a pé pelo tamanho do corpo (≥ 1); `h` = a altura de agora, se souber. */
function bodyStride(body, h) {
  return Math.max(1, (h > 0 ? h : bodyHeight(body)) / BASE_HEIGHT);
}

module.exports = { HEIGHT, BASE_HEIGHT, GROW, bodyHeight, grownHeight, bodyStride };
