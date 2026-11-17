// src/utils/mmItems/rules/classStats.js — STATUS DA CLASSE DE RARIDADE (decisão do Alex, 2026-11-17).
//
// Cada peça equipável tem UM NÚMERO INTEIRO e UMA PORCENTAGEM, os dois pela classe (rules/rank.js):
//   da E até a A cada classe vale o DOBRO da anterior; do S para cima, o TRIPLO. Nada tem teto.
//
//   classe   E    D    C    B    A    S     SS    SSR    Lendária  Divina
//   número   5    10   20   40   80   240   720   2160   6480      19440
//   %        20   25   30   35   40   45    50    55     60        110   (Alex, 2026-11-17: de 5 em 5; a Divina +50)
//
// O número e a porcentagem se DIVIDEM entre até 3 status do TIPO da peça (SPLIT). Exemplo do Alex:
// a espada divide o número em acerto 40% · força 40% · esquiva 20% e a porcentagem em dano 50% ·
// força 50%; o escudo fica nos de defesa e no HP.
//
// Status (os da ficha da luta): hp (vida), atk (força = ataque), def (defesa), acc (acerto),
// spd (esquiva), stam (fôlego). Porcentagem: as mesmas chaves + dmg (dano que passa).
//
// Cada peça varia ±10% no número e ±2% na porcentagem em volta da média da classe (fixo por id), para duas peças da mesma classe
// não ficarem iguais. A luta usa isso na R2 (ataque − defesa com piso de 10%, acerto ÷ esquiva).
"use strict";

const { RANKS } = require("./rank");

/** Número inteiro médio de cada classe. */
const NUMBER = Object.freeze({ E: 5, D: 10, C: 20, B: 40, A: 80, S: 240, SS: 720, SSR: 2160, legendary: 6480, divine: 19440 });
/** Porcentagem média de cada classe (em %, não fração). */
const PERCENT = Object.freeze({ E: 20, D: 25, C: 30, B: 35, A: 40, S: 45, SS: 50, SSR: 55, legendary: 60, divine: 110 });
/**
 * Preço da arma/escudo da loja pela classe (Alex, 2026-11-17): E = 800 e cada classe custa 3× a anterior
 * até a A; do S para cima, 5×. A Lendária e a Divina não se vendem (o valor fica para comparar).
 */
const PRICE = Object.freeze({ E: 800, D: 2400, C: 7200, B: 21600, A: 64800, S: 324000, SS: 1620000, SSR: 8100000, legendary: 40500000, divine: 202500000 });

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
  // a % varia só ±2% (a escada da % anda de 5 em 5: com ±10% uma SS passaria uma SSR)
  const percent = r2(PERCENT[item.rank] * (1 + (k - 1) * 0.2));
  const { n, p } = SPLIT[kind];
  const flat = {};
  for (const [s, w] of Object.entries(n)) flat[s] = Math.max(1, Math.round(number * w));
  const pct = {};
  for (const [s, w] of Object.entries(p)) pct[s] = r2(percent * w);
  return { kind, rank: item.rank, number, percent, flat, pct };
}

/**
 * Soma da classe das peças vestidas, para a luta (`setup.classGear`): { flat: { status: inteiro }, pct: { chave: % } }.
 * `items` = itens do catálogo (com `stats`). Sem peça = {} nos dois lados (a luta nova roda mesmo assim).
 */
function classGearOf(items) {
  const flat = {};
  const pct = {};
  for (const it of items || []) {
    const st = it && it.stats;
    if (!st) continue;
    for (const [k, v] of Object.entries(st.flat)) flat[k] = (flat[k] || 0) + v;
    for (const [k, v] of Object.entries(st.pct)) pct[k] = r2((pct[k] || 0) + v);
  }
  return { flat, pct };
}

module.exports = { PRICE, NUMBER, PERCENT, FLAT_KEYS, PCT_KEYS, SPLIT, KINDS, kindOf, spreadOf, classStatsOf, classGearOf };
