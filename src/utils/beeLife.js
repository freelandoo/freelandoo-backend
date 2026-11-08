// src/utils/beeLife.js — VIDA DO BEE PELO EMBALO (regra do Alex, 2026-11-08). Fonte única.
//
// O bee não tem prazo fixo. Fica no ar enquanto continua crescendo e some
// quando o crescimento cai muito em relação ao melhor momento dele:
//
//   embalo (momentum) = pontos de alcance recentes (os mesmos do A1: view,
//                       curtida, comentário, salvar, compartilhar, retenção…),
//                       que perdem METADE a cada HALF_LIFE_HOURS sem ganho;
//   pico              = o maior embalo que o bee já teve;
//   vivo              = nas primeiras GRACE_HOURS, sempre; depois, enquanto
//                       embalo ≥ max(MIN_MOMENTUM, KEEP_FRACTION × pico).
//
// Na prática: parou de ganhar ponto, o embalo cai a 15% do pico em ~33 h e o
// bee sai. Quem ganha devagar e sempre fica; quem estourou e esfriou sai. O
// degrau de alcance (cidade → área → região → estado → Brasil) segue a regra
// do feedReach.js (só sobe) — é ele que dá a COR do bee e do post.
//
// O embalo só é gravado no evento (ReachStorage.addPoints); a leitura decai
// pelo relógio. Sem job.

const BEE_LIFE = Object.freeze({
  GRACE_HOURS: 24,
  HALF_LIFE_HOURS: 12,
  MIN_MOMENTUM: 10,
  KEEP_FRACTION: 0.15,
});

/** Embalo decaído até `now` (ms). */
function momentumNow(momentum, momentumAt, now = Date.now()) {
  const m = Math.max(0, Number(momentum) || 0);
  if (!m || !momentumAt) return 0;
  const h = Math.max(0, (now - new Date(momentumAt).getTime()) / 3.6e6);
  return m * Math.pow(0.5, h / BEE_LIFE.HALF_LIFE_HOURS);
}

function keepFloor(peak) {
  return Math.max(BEE_LIFE.MIN_MOMENTUM, BEE_LIFE.KEEP_FRACTION * (Number(peak) || 0));
}

/** Vivo pela regra (linha com created_at, deleted_at, momentum, momentum_at, momentum_peak). */
function beeAlive(row, now = Date.now()) {
  if (!row || row.deleted_at) return false;
  const age = (now - new Date(row.created_at).getTime()) / 3.6e6;
  if (age < BEE_LIFE.GRACE_HOURS) return true;
  return momentumNow(row.momentum, row.momentum_at, now) >= keepFloor(row.momentum_peak);
}

/** Embalo depois de somar `delta` agora: { momentum, peak }. */
function addMomentum(row, delta, now = Date.now()) {
  const m = Math.max(0, momentumNow(row.momentum, row.momentum_at, now) + (Number(delta) || 0));
  return { momentum: m, peak: Math.max(Number(row.momentum_peak) || 0, m) };
}

// ── SQL (espelho; o e2e confere) ─────────────────────────────────────────
const HL_S = BEE_LIFE.HALF_LIFE_HOURS * 3600;
const momentumNowSql = (a = "s") =>
  `(${a}.momentum * POWER(0.5, GREATEST(EXTRACT(EPOCH FROM (NOW() - COALESCE(${a}.momentum_at, NOW()))), 0) / ${HL_S}))`;
const keepFloorSql = (a = "s") => `GREATEST(${BEE_LIFE.MIN_MOMENTUM}, ${BEE_LIFE.KEEP_FRACTION} * ${a}.momentum_peak)`;

// Substitui o antigo "24 h + 1 h por ponto, teto 7 dias". Inclui o deleted_at.
const BEE_ALIVE_SQL = `
  s.deleted_at IS NULL
  AND (
    s.created_at > NOW() - INTERVAL '${BEE_LIFE.GRACE_HOURS} hours'
    OR ${momentumNowSql("s")} >= ${keepFloorSql("s")}
  )
`;

// Quando sai, se nada mais acontecer (estimativa para a tela): o maior entre o fim
// da carência e o instante em que o embalo de agora decai até o piso.
const BEE_EXPIRES_SQL = `
  GREATEST(
    s.created_at + INTERVAL '${BEE_LIFE.GRACE_HOURS} hours',
    COALESCE(s.momentum_at, s.created_at)
      + (${BEE_LIFE.HALF_LIFE_HOURS} * LOG(2, GREATEST(s.momentum / ${keepFloorSql("s")}, 1)::numeric)) * INTERVAL '1 hour'
  )
`;

module.exports = { BEE_LIFE, momentumNow, keepFloor, beeAlive, addMomentum, momentumNowSql, keepFloorSql, BEE_ALIVE_SQL, BEE_EXPIRES_SQL };
