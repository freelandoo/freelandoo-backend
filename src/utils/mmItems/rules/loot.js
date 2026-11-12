// src/utils/mmItems/rules/loot.js — trilha E, fatia E3: o sorteio de uma TABELA de saque (regra pura).
// Quem entrega é `MeuMundoRewardService.grant` (porta única, com recibo); aqui só se decide o quê.
"use strict";

const { TABLES } = require("../catalog/loot");
const { DOMAIN_NAME } = require("../catalog/lines");

/** Quantidade de uma linha. `R` só é chamado quando há faixa de verdade (a ordem dos sorteios importa). */
function qtyOf(q, { win, activeMs }, R) {
  if (Array.isArray(q)) {
    const [a, b] = q;
    return a === b ? a : a + Math.floor(R() * (b - a + 1));
  }
  if (q && q.byMinutes) {
    const minutes = Math.max(0, activeMs || 0) / 60000;
    return Math.max(1, Math.min(4, Math.round(minutes / 2))) + (win ? q.win || 0 : 0);
  }
  // E17: fichas = minutos ativos ÷ 2 (arredondado) + 1 se venceu, sem teto nem sorteio
  if (q && q.tokens) return Math.round(Math.max(0, activeMs || 0) / 120000) + (win ? 1 : 0);
  return 0;
}

/**
 * Sorteia a tabela: [{ id, qty, rarity }] (mesmo id somado, na ordem em que apareceu).
 * `ctx` = { win, activeMs, level, first }; `level` não muda a quantidade (I: saque não depende do nível).
 * `rarityOf(id)` vem do catálogo (o index injeta).
 */
function rollTable(tableId, ctx, R, rarityOf) {
  const t = TABLES[tableId];
  if (!t) return [];
  const win = !!ctx.win;
  const out = new Map();
  const add = (id, n) => id && n > 0 && out.set(id, (out.get(id) || 0) + n);
  for (const e of t.sure || []) if (!(e.win && !win)) add(e.id, qtyOf(e.qty, ctx, R));
  for (const e of t.chance || []) {
    if (e.win && !win) continue;
    if (R() < e.p) add(e.id, qtyOf(e.qty, ctx, R));
  }
  if (win && ctx.first) for (const e of t.first || []) add(e.id, qtyOf(e.qty, ctx, R));
  return [...out.entries()].map(([id, qty]) => ({ id, qty, rarity: rarityOf ? rarityOf(id) : "common" }));
}

/** Faixa [mín, máx] de uma linha para um contexto (sem sorteio). */
function rangeOf(q, ctx) {
  if (Array.isArray(q)) return [q[0], q[1]];
  if (q && (q.byMinutes || q.tokens)) {
    const n = qtyOf(q, ctx, () => 0);
    return [n, n];
  }
  return [0, 0];
}

/**
 * Esperado e pior caso de uma tabela num contexto: { id: { expected, min, max } }.
 * Usado pelo `mm-balance.js --loot` e pelo teste de que o saque não depende do nível.
 */
function expectation(tableId, ctx) {
  const t = TABLES[tableId];
  const out = {};
  if (!t) return out;
  const win = !!ctx.win;
  const put = (id, p, [a, b]) => {
    const o = (out[id] ||= { expected: 0, min: 0, max: 0 });
    o.expected += p * ((a + b) / 2);
    if (p >= 1) o.min += a;
    o.max += b;
  };
  for (const e of t.sure || []) if (!(e.win && !win)) put(e.id, 1, rangeOf(e.qty, ctx));
  for (const e of t.chance || []) if (!(e.win && !win)) put(e.id, e.p, rangeOf(e.qty, ctx));
  if (win && ctx.first) for (const e of t.first || []) put(e.id, 1, rangeOf(e.qty, ctx));
  for (const o of Object.values(out)) o.expected = Math.round(o.expected * 1000) / 1000;
  return out;
}

/** De onde vem um item pelas tabelas: [{ table, kind: "sure"|"chance"|"first", p, qty, note }]. */
function lootSourcesOf(itemId) {
  const out = [];
  for (const [table, t] of Object.entries(TABLES)) {
    for (const e of t.sure || []) if (e.id === itemId) out.push({ table, kind: "sure", p: 1, qty: e.qty });
    for (const e of t.chance || []) if (e.id === itemId) out.push({ table, kind: "chance", p: e.p, qty: e.qty, win: !!e.win, note: e.note || null });
    for (const e of t.first || []) if (e.id === itemId) out.push({ table, kind: "first", p: 1, qty: e.qty });
  }
  return out;
}

const pctText = (p) => String(Math.round(p * 1000) / 10).replace(".", ",") + "%";
const rangeText = (a, b) => (a === b ? String(a) : `${a} a ${b}`);
/** Setores em texto: "em todo setor", "no setor 7", "nos setores 7 a 10", "nos setores 1, 3 e 5". */
function sectorsText(list) {
  const xs = [...new Set(list)].sort((a, b) => a - b);
  if (xs.length === 10 && xs[0] === 1 && xs[9] === 10) return "em todo setor";
  if (xs.length === 1) return `no setor ${xs[0]}`;
  if (xs[xs.length - 1] - xs[0] === xs.length - 1) return `nos setores ${xs[0]} a ${xs[xs.length - 1]}`;
  return `nos setores ${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;
}
const domainsText = (names, all) => (all ? "Todos os Domínios" : names.length === 1 ? `Domínio ${names[0]}` : `Domínios ${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`);

/**
 * E12: as 60 tabelas de setor viram poucas linhas — por Domínio e tipo (garantido, chance,
 * primeira vitória) os setores se juntam; Domínios com a mesma frase se juntam também.
 */
function domainSourceLines(entries) {
  const per = new Map(); // `${domain}|${kind}` → { domain, kind, sectors, p: [min,max], q: [min,max] }
  for (const s of entries) {
    const t = TABLES[s.table];
    const k = `${t.domain}|${s.kind}`;
    const [a, b] = Array.isArray(s.qty) ? s.qty : [0, 0];
    const g = per.get(k) || { domain: t.domain, kind: s.kind, sectors: [], p: [s.p, s.p], q: [a, b] };
    g.sectors.push(t.sector);
    g.p = [Math.min(g.p[0], s.p), Math.max(g.p[1], s.p)];
    g.q = [Math.min(g.q[0], a), Math.max(g.q[1], b)];
    per.set(k, g);
  }
  const phrase = (g) => {
    const where = sectorsText(g.sectors);
    if (g.kind === "sure") return `garantido ${where} (${rangeText(g.q[0], g.q[1])} por vitória)`;
    if (g.kind === "first") return `primeira vitória ${where}${g.q[1] > 1 ? ` (${rangeText(g.q[0], g.q[1])} de bônus)` : ""}`;
    return `chance de ${g.p[0] === g.p[1] ? pctText(g.p[0]) : `${pctText(g.p[0])} a ${pctText(g.p[1])}`} por vitória ${where}`;
  };
  const byPhrase = new Map(); // frase → { kind, domains }
  for (const g of per.values()) {
    const f = phrase(g);
    const o = byPhrase.get(f) || { kind: g.kind, domains: [] };
    o.domains.push(g.domain);
    byPhrase.set(f, o);
  }
  const total = new Set(Object.values(TABLES).filter((t) => t.domain).map((t) => t.domain)).size;
  const order = ["sure", "chance", "first"];
  return [...byPhrase.entries()]
    .sort((x, y) => order.indexOf(x[1].kind) - order.indexOf(y[1].kind))
    .map(([f, o]) => `${domainsText(o.domains.map((d) => DOMAIN_NAME[d] || d), o.domains.length === total && total > 1)}: ${f}.`);
}

/** "Onde conseguir" em texto (pt de reserva; o front traduz por `gearSource_<id>`). */
function lootSourceLines(itemId) {
  const all = lootSourcesOf(itemId);
  const dom = all.filter((s) => TABLES[s.table].domain);
  return all.filter((s) => !TABLES[s.table].domain).map((s) => {
    const t = TABLES[s.table];
    if (t.chest) return `${t.label}: uma vez por conta, no lugar dele.`; // E18
    if (s.kind === "sure") return `${t.label}: material básico garantido de uma atividade validada.`;
    if (s.kind === "first") return `${t.label}: garantido na primeira vitória.`;
    const pct = Math.round(s.p * 1000) / 10;
    return `${t.winLabel || t.label}: chance de ${String(pct).replace(".", ",")}%${s.note ? "; " + s.note : ""}.`;
  }).concat(dom.length ? domainSourceLines(dom) : []);
}

module.exports = { rollTable, expectation, lootSourcesOf, lootSourceLines, qtyOf };
