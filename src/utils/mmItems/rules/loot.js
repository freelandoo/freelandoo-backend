// src/utils/mmItems/rules/loot.js — trilha E, fatia E3: o sorteio de uma TABELA de saque (regra pura).
// Quem entrega é `MeuMundoRewardService.grant` (porta única, com recibo); aqui só se decide o quê.
"use strict";

const { TABLES } = require("../catalog/loot");

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
  for (const e of t.sure || []) add(e.id, qtyOf(e.qty, ctx, R));
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
  if (q && q.byMinutes) {
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
  for (const e of t.sure || []) put(e.id, 1, rangeOf(e.qty, ctx));
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

/** "Onde conseguir" em texto (pt de reserva; o front traduz por `gearSource_<id>`). */
function lootSourceLines(itemId) {
  return lootSourcesOf(itemId).map((s) => {
    const t = TABLES[s.table];
    if (s.kind === "sure") return `${t.label}: material básico garantido de uma atividade validada.`;
    if (s.kind === "first") return `${t.label}: garantido na primeira vitória.`;
    const pct = Math.round(s.p * 1000) / 10;
    return `${t.winLabel || t.label}: chance de ${String(pct).replace(".", ",")}%${s.note ? "; " + s.note : ""}.`;
  });
}

module.exports = { rollTable, expectation, lootSourcesOf, lootSourceLines, qtyOf };
