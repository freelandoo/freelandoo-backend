// src/utils/mmItems/rules/classStats.js — STATUS DA CLASSE DE RARIDADE (decisão do Alex, 2026-11-17).
//
// Cada peça equipável tem UM NÚMERO INTEIRO e UMA PORCENTAGEM, os dois pela classe (rules/rank.js):
//   da E até a A cada classe vale o DOBRO da anterior; do S para cima, o TRIPLO. Nada tem teto.
//
//   classe   E    D    C    B    A    S     SS    SSR    Lendária  Divina
//   número   5    10   20   40   80   240   720   2160   6480      19440
//   %        0,1  0,2  0,4  0,8  1,6  4,8   14,4  43,2   129,6     388,8
//
// O número e a porcentagem se DIVIDEM entre até 3 status do TIPO da peça (SPLIT). Exemplo do Alex:
// a espada divide o número em acerto 40% · força 40% · esquiva 20% e a porcentagem em dano 50% ·
// força 50%; o escudo fica nos de defesa e no HP.
//
// Status (os da ficha da luta): hp (vida), atk (força = ataque), def (defesa), acc (acerto),
// spd (esquiva), stam (fôlego). Porcentagem: as mesmas chaves + dmg (dano que passa).
//
// Cada peça varia ±10% em volta da média da classe (fixo por id), para duas peças da mesma classe
// não ficarem iguais. A luta usa isso na R2 (ataque − defesa com piso de 10%, acerto ÷ esquiva).
"use strict";

const { RANKS } = require("./rank");

/** Número inteiro médio de cada classe. */
const NUMBER = Object.freeze({ E: 5, D: 10, C: 20, B: 40, A: 80, S: 240, SS: 720, SSR: 2160, legendary: 6480, divine: 19440 });
/** Porcentagem média de cada classe (em %, não fração). */
const PERCENT = Object.freeze({ E: 0.1, D: 0.2, C: 0.4, B: 0.8, A: 1.6, S: 4.8, SS: 14.4, SSR: 43.2, legendary: 129.6, divine: 388.8 });

/** Status que o número pode levar e chaves que a porcentagem pode levar. */
const FLAT_KEYS = Object.freeze(["hp", "atk", "def", "acc", "spd", "stam"]);
const PCT_KEYS = Object.freeze(["dmg", "hp", "atk", "def", "acc", "spd", "stam"]);

/** Divisão por tipo de peça: `n` = o número, `p` = a porcentagem (cada lado soma 1). */
const SPLIT = Object.freeze({
  sword: Object.freeze({ n: { acc: 0.4, atk: 0.4, spd: 0.2 }, p: { dmg: 0.5, atk: 0.5 } }),
  staff: Object.freeze({ n: { acc: 0.4, atk: 0.4, spd: 0.2 }, p: { dmg: 0.5, atk: 0.5 } }),
  heavy: Object.freeze({ n: { atk: 0.5, hp: 0.3, def: 0.2 }, p: { dmg: 0.5, atk: 0.5 } }),
  bow: Object.freeze({ n: { acc: 0.5, atk: 0.3, spd: 0.2 }, p: { dmg: 0.5, acc: 0.5 } }),
  gun: Object.freeze({ n: { acc: 0.5, atk: 0.4, spd: 0.1 }, p: { dmg: 0.6, acc: 0.4 } }),
  shield: Object.freeze({ n: { hp: 0.4, def: 0.4, stam: 0.2 }, p: { def: 0.5, hp: 0.5 } }),
  chest: Object.freeze({ n: { hp: 0.5, def: 0.4, stam: 0.1 }, p: { hp: 0.5, def: 0.5 } }),
  helm: Object.freeze({ n: { acc: 0.4, hp: 0.3, def: 0.3 }, p: { acc: 0.5, hp: 0.5 } }),
  gloves: Object.freeze({ n: { acc: 0.4, atk: 0.4, spd: 0.2 }, p: { acc: 0.5, atk: 0.5 } }),
  boots: Object.freeze({ n: { spd: 0.5, stam: 0.3, hp: 0.2 }, p: { spd: 0.5, stam: 0.5 } }),
  amulet: Object.freeze({ n: { hp: 0.4, atk: 0.3, acc: 0.3 }, p: { hp: 0.5, dmg: 0.5 } }),
  relic: Object.freeze({ n: { hp: 0.4, def: 0.3, spd: 0.3 }, p: { dmg: 0.5, hp: 0.5 } }),
});
const KINDS = Object.freeze(Object.keys(SPLIT));

const SHOP_KIND = Object.freeze({ weapons: "sword", hammers: "heavy", bows: "bow", guns: "gun", shields: "shield" });
/** Tipo da peça para a divisão (null = não é equipável). */
function kindOf(item) {
  if (!item || !item.slot) return null;
  if (item.slot === "weapon") return SHOP_KIND[item.shop] || (String(item.id).startsWith("cajado_") ? "staff" : "sword");
  if (item.slot === "offhand") return "shield";
  return SPLIT[item.slot] ? item.slot : null;
}

/** Variação fixa da peça, de 0,9 a 1,1, pelo id (FNV-1a). */
function spreadOf(id) {
  let h = 0x811c9dc5;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return 0.9 + 0.2 * (h / 0xffffffff);
}

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Status da peça pela classe: { kind, rank, number, percent, flat: { status: inteiro }, pct: { chave: % } }.
 * `number`/`percent` = o total da peça (média da classe × variação); `flat` e `pct` = a divisão.
 * Peça não equipável (ou sem classe) = null.
 */
function classStatsOf(item) {
  const kind = kindOf(item);
  if (!kind || !RANKS.includes(item.rank)) return null;
  const k = spreadOf(item.id);
  const number = Math.max(1, Math.round(NUMBER[item.rank] * k));
  const percent = r2(PERCENT[item.rank] * k);
  const { n, p } = SPLIT[kind];
  const flat = {};
  for (const [s, w] of Object.entries(n)) flat[s] = Math.max(1, Math.round(number * w));
  const pct = {};
  for (const [s, w] of Object.entries(p)) pct[s] = r2(percent * w);
  return { kind, rank: item.rank, number, percent, flat, pct };
}

module.exports = { NUMBER, PERCENT, FLAT_KEYS, PCT_KEYS, SPLIT, KINDS, kindOf, spreadOf, classStatsOf };
