// src/utils/academyCalendar.js
// As contas do calendário de frequência (mig 310) — puras, para o teste
// unitário cobrir sem banco.
//
// ⚠️ TUDO NO FUSO DE BRASÍLIA. "Hoje" em UTC vira amanhã às 21h e o calendário
// marcaria ✕ num dia que ainda não acabou.

const TZ = "America/Sao_Paulo";

/** 'YYYY-MM-DD' de um instante, no fuso de Brasília. */
function localDay(at = new Date()) {
  // en-CA formata como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at instanceof Date ? at : new Date(at));
}

function isYm(s) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ""));
}

/** 'YYYY-MM' → { first:'YYYY-MM-01', next:'YYYY-MM-01' do mês seguinte, days }. */
function monthBounds(ym) {
  const [y, m] = ym.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return {
    first: `${ym}-01`,
    next: `${ny}-${String(nm).padStart(2, "0")}-01`,
    days,
  };
}

/** Desliza um 'YYYY-MM' por `delta` meses. */
function shiftYm(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Dias corridos entre dois 'YYYY-MM-DD' (b − a). */
function dayDiff(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * O resumo de um mês:
 *  - `elapsed`: dias do mês que JÁ PASSARAM e são depois do vínculo (os que
 *    podem virar ✕). Hoje não conta: o dia ainda não acabou.
 *  - `present`: dias com catraca no mês.
 * `present` pode passar de `elapsed` (veio hoje) — a tela mostra "N de M" com
 * hoje somado ao M quando houve entrada.
 */
function monthSummary({ ym, presentDays, linkedDay, todayDay }) {
  const { first, days } = monthBounds(ym);
  let elapsed = 0;
  for (let d = 1; d <= days; d++) {
    const day = `${ym}-${String(d).padStart(2, "0")}`;
    if (day < todayDay && day >= linkedDay) elapsed++;
  }
  const present = presentDays.filter((d) => d.startsWith(ym)).length;
  return { first, days, elapsed, present };
}

/**
 * Sequência de dias SEGUIDOS com catraca terminando hoje — ou ontem, quando
 * ainda não veio hoje (o dia não acabou: não quebra a sequência às 7h).
 * `presentDays` ordenados ou não; repetidos não importam.
 */
function currentStreak(presentDays, todayDay) {
  const set = new Set(presentDays);
  let cursor = set.has(todayDay) ? todayDay : shiftDay(todayDay, -1);
  let n = 0;
  while (set.has(cursor)) {
    n++;
    cursor = shiftDay(cursor, -1);
  }
  return n;
}

function shiftDay(day, delta) {
  const t = Date.parse(`${day}T00:00:00Z`) + delta * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

module.exports = {
  TZ,
  localDay,
  isYm,
  monthBounds,
  shiftYm,
  dayDiff,
  monthSummary,
  currentStreak,
  shiftDay,
};
