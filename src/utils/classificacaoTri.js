// src/utils/classificacaoTri.js
//
// A6 CLASSIFICAÇÃO (migs 395/396): a NOTA da prova pela TRI de dois parâmetros.
//
// Regra única, pura e sem banco (o teste unitário roda isto direto):
//   P(acerto | θ) = 1 / (1 + e^(−a·(θ − b)))      — 2PL logístico, sem D = 1,7
//   θ estimado por EAP (média a posteriori) com prior N(0, 1) numa grade de −4 a 4
//   nota = round(100 · Φ(θ))                      — 50 = a média, 84 = 1 desvio acima
//
// Por que EAP e não máxima verossimilhança: quem acerta (ou erra) tudo não tem
// estimativa de MV (θ vai ao infinito). Com o prior a nota fica finita e estável
// desde o primeiro item, o que a prova ADAPTATIVA precisa para escolher o próximo.
//
// A prova é adaptativa (CAT): 20 itens, cada um escolhido pela informação de
// Fisher no θ atual, respeitando o peso das áreas (economia e finanças pesam mais)
// e sorteando entre os 4 mais informativos para não mostrar sempre os mesmos.

const AREAS = Object.freeze(["economia", "financas", "historia", "geografia", "gerais"]);

// Peso de cada área na prova (soma 1). Decisão do A6: economia + finanças = 55%.
const AREA_WEIGHTS = Object.freeze({
  economia: 0.3,
  financas: 0.25,
  historia: 0.15,
  geografia: 0.15,
  gerais: 0.15,
});

const TEST_LENGTH = 20;
const RANDOMESQUE = 4; // sorteio entre os N itens mais informativos

const GRID = (() => {
  const g = [];
  for (let i = 0; i <= 80; i += 1) g.push(-4 + i * 0.1);
  return Object.freeze(g);
})();

/** Probabilidade de acerto no 2PL. */
function p2pl(theta, a, b) {
  return 1 / (1 + Math.exp(-a * (theta - b)));
}

/** Informação de Fisher do item 2PL em θ: a² · P · (1 − P). */
function itemInfo(theta, a, b) {
  const p = p2pl(theta, a, b);
  return a * a * p * (1 - p);
}

function normalPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Φ(x) — acumulada da normal padrão (Abramowitz–Stegun 7.1.26, erro < 1,5e−7). */
function normalCdf(x) {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/**
 * θ por EAP. `responses` = [{ a, b, correct }]. Sem respostas devolve o prior
 * (θ 0, erro 1).
 */
function estimateTheta(responses) {
  const list = Array.isArray(responses) ? responses : [];
  let sw = 0;
  let swt = 0;
  const post = GRID.map((t) => {
    let l = normalPdf(t);
    for (const r of list) {
      const p = p2pl(t, Number(r.a), Number(r.b));
      l *= r.correct ? p : 1 - p;
    }
    sw += l;
    swt += l * t;
    return l;
  });
  if (!(sw > 0)) return { theta: 0, se: 1 };
  const theta = swt / sw;
  let v = 0;
  GRID.forEach((t, i) => {
    v += post[i] * (t - theta) * (t - theta);
  });
  return { theta, se: Math.sqrt(v / sw) };
}

/** A nota de 0 a 100 a partir de θ. */
function scoreFromTheta(theta) {
  if (!Number.isFinite(theta)) return 0;
  return Math.max(0, Math.min(100, Math.round(100 * normalCdf(theta))));
}

/** Quantos itens de cada área numa prova de `length` itens (maiores restos). */
function blueprint(length = TEST_LENGTH) {
  const raw = AREAS.map((k) => ({ k, x: AREA_WEIGHTS[k] * length }));
  const out = {};
  let used = 0;
  for (const r of raw) {
    out[r.k] = Math.floor(r.x);
    used += out[r.k];
  }
  raw
    .slice()
    .sort((p, q) => q.x - Math.floor(q.x) - (p.x - Math.floor(p.x)) || AREAS.indexOf(p.k) - AREAS.indexOf(q.k))
    .slice(0, length - used)
    .forEach((r) => {
      out[r.k] += 1;
    });
  return out;
}

/**
 * O próximo item da prova adaptativa.
 *
 * `bank` = [{ id, area, a, b }], `answered` = [{ id, area, a, b, correct }].
 * Escolhe a área mais atrasada em relação ao blueprint (empate = ordem de AREAS),
 * e dentro dela sorteia entre os RANDOMESQUE itens de maior informação em θ.
 * Área sem item sobrando cai para o banco inteiro. Devolve null quando acabou.
 */
function pickNextItem(bank, answered, { length = TEST_LENGTH, rng = Math.random } = {}) {
  const done = Array.isArray(answered) ? answered : [];
  if (done.length >= length) return null;
  const used = new Set(done.map((r) => String(r.id)));
  const free = (bank || []).filter((it) => !used.has(String(it.id)));
  if (!free.length) return null;

  const { theta } = estimateTheta(done);
  const plan = blueprint(length);
  const count = {};
  for (const r of done) count[r.area] = (count[r.area] || 0) + 1;

  const byNeed = AREAS.map((k) => ({ k, need: plan[k] - (count[k] || 0) }))
    .filter((x) => x.need > 0)
    .sort((p, q) => q.need / plan[q.k] - p.need / plan[p.k] || AREAS.indexOf(p.k) - AREAS.indexOf(q.k));

  let pool = [];
  for (const { k } of byNeed) {
    pool = free.filter((it) => it.area === k);
    if (pool.length) break;
  }
  if (!pool.length) pool = free;

  const ranked = pool
    .map((it) => ({ it, info: itemInfo(theta, Number(it.a), Number(it.b)) }))
    .sort((p, q) => q.info - p.info);
  const top = ranked.slice(0, Math.min(RANDOMESQUE, ranked.length));
  const idx = Math.min(top.length - 1, Math.floor(rng() * top.length));
  return top[idx].it;
}

/** Acertos por área, para o resumo do resultado. */
function areaSummary(answered) {
  const out = {};
  for (const r of answered || []) {
    const s = out[r.area] || (out[r.area] = { n: 0, ok: 0 });
    s.n += 1;
    if (r.correct) s.ok += 1;
  }
  return out;
}

module.exports = {
  AREAS,
  AREA_WEIGHTS,
  TEST_LENGTH,
  RANDOMESQUE,
  p2pl,
  itemInfo,
  normalCdf,
  estimateTheta,
  scoreFromTheta,
  blueprint,
  pickNextItem,
  areaSummary,
};
