// src/utils/mmItems/rules/weaponProgress.js — ARMAS: NÍVEL 1–90 POR BARRA DE XP, PÓ DA CLASSE, ESTRELAS E
// FRAGMENTOS DE CLASSE (weapon-v2, 24/11/2026). Regra pura, sem banco. Plano: MEU MUNDO 3D/planos/2026-11-24-armas-refino-forja.md.
//
// Três eixos que NÃO se misturam:
//   • classe da arma (`rank`: E…SSR, Lendária, Divina) — do catálogo, nunca muda;
//   • NÍVEL da cópia (1…MAX_LEVEL) — cada nível tem uma BARRA DE XP; cada tentativa de refino gasta 1 PÓ DA
//     CLASSE DA ARMA (pó B só refina arma B) e sorteia um XP (pode ser muito, pouco ou até tirar XP);
//     a pessoa ACEITA ou RECUSA o resultado (recusar descarta o XP; o pó já foi). "10 vezes" aceita sozinho
//     só o que aumenta. A barra dobra a cada 5 níveis (pedido do Alex): 100 no nível 1 … ~20 milhões no 89.
//     O XP que passa vai para o próximo nível; perder XP nunca derruba de nível (para no começo da barra).
//   • ESTRELAS da cópia (1…MAX_STARS) — sobem na forja consumindo uma cópia IDÊNTICA (mesmo item), sempre.
// Fragmentos são da CLASSE: com FRAGMENT_NEED[classe] o jogador escolhe QUAL arma daquela classe montar.
// (weapon-v1 tinha pó por faixa de nível e chance de sucesso; saiu no mesmo dia — os pós SSS I/II/III viraram
// os pós SSR/Lendária/Divina 1:1 por catalog/retired.js.)
//
// Bônus: o nível ocupa a fatia `plus` da régua (budget.SHARE.plus) contra uma REFERÊNCIA FIXA
// (LEVEL_REF = 90). As estrelas ocupam a fatia `grade` (coluna `grade` da instância: 1 estrela = grau I … 5 = grau V).
"use strict";

const B = require("./budget");
const { RANKS } = require("./rank");

/** Versão da REGRA de refino (o aparelho manda; diferente = 410 e a tela recarrega). */
const RULES_VERSION = "weapon-v2";
/** Formato da CÓPIA da arma no banco (nível + estrelas): não mudou da v1, então a conversão não roda de novo. */
const INSTANCE_RULES = "weapon-v1";
/** Teto de negócio de hoje (o banco aceita até 999: chk_mm_instance_weapon_level, mig 466). */
const MAX_LEVEL = 90;
/** Referência fixa do bônus (não acompanha MAX_LEVEL). */
const LEVEL_REF = 90;
const MAX_STARS = B.GRADE_MAX; // 5
/** "Refinar 10 vezes". */
const BATCH = 10;

const RANK_LABEL = Object.freeze({ legendary: "Lendária", divine: "Divina" });
const powderOf = (rank) => `po_ref_${String(rank).toLowerCase()}`;
/** Os 10 pós, um por classe (a mesma ordem de RANKS). */
const POWDER_RARITY = Object.freeze({ E: "common", D: "common", C: "uncommon", B: "uncommon", A: "rare", S: "rare", SS: "epic", SSR: "epic", legendary: "legendary", divine: "mythic" });
const POWDERS = Object.freeze(RANKS.map((r) => Object.freeze({ id: powderOf(r), rank: r, name: `Pó de Refinamento ${RANK_LABEL[r] || r}`, rarity: POWDER_RARITY[r] })));
const POWDER_IDS = Object.freeze(POWDERS.map((p) => p.id));
/** Pós da weapon-v1 que saíram (a pilha vira o pó da classe correspondente, 1:1). */
const LEGACY_POWDERS = Object.freeze({ po_ref_sss1: "po_ref_ssr", po_ref_sss2: "po_ref_legendary", po_ref_sss3: "po_ref_divine" });

/**
 * O sorteio de cada tentativa: faixa por `p` e, dentro dela, um inteiro uniforme em [min, max].
 * Média ≈ +48 por pó; aceitando só o que sobe (o "10 vezes"), ≈ +52 por pó (a perda vira 0).
 */
const TIERS = Object.freeze([
  { id: "loss", p: 0.15, min: -40, max: -10 },
  { id: "normal", p: 0.6, min: 20, max: 60 },
  { id: "good", p: 0.2, min: 60, max: 120 },
  { id: "great", p: 0.05, min: 150, max: 250 },
].map(Object.freeze));

/** XP para sair do nível `level` (1…89): 100 e dobra a cada 5 níveis. No teto: null. */
function xpNeed(level) {
  const n = Number(level);
  if (!Number.isInteger(n) || n < 1 || n >= MAX_LEVEL) return null;
  return Math.round(100 * 2 ** ((n - 1) / 5));
}

/** Um sorteio a partir de dois números do servidor em [0,1): { tier, xp }. */
function rollXp(r1, r2) {
  let acc = 0;
  let tier = TIERS[TIERS.length - 1];
  for (const t of TIERS) { acc += t.p; if (Number(r1) < acc) { tier = t; break; } }
  const span = tier.max - tier.min + 1;
  const xp = tier.min + Math.min(span - 1, Math.floor(Math.max(0, Number(r2)) * span));
  return { tier: tier.id, xp };
}

/**
 * Aplica `delta` à cópia (nível + XP dentro do nível): sobra passa de nível (quantos couberem), perda para em 0
 * (nunca desce de nível). No teto o XP fica 0. Devolve { level, xp, up } (up = níveis ganhos).
 */
function applyXp(level, xp, delta) {
  let lv = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
  let cur = Math.max(0, Math.floor(Number(xp) || 0) + Math.trunc(Number(delta) || 0));
  const from = lv;
  while (lv < MAX_LEVEL && cur >= xpNeed(lv)) { cur -= xpNeed(lv); lv++; }
  if (lv >= MAX_LEVEL) cur = 0;
  return { level: lv, xp: cur, up: lv - from };
}

/** Fragmentos para montar UMA arma, por classe: E = 20 e +20 a cada classe acima (… Divina = 200). Pedido do Alex, 24/11. */
const FRAGMENT_NEED = Object.freeze(Object.fromEntries(RANKS.map((r, i) => [r, 20 * (i + 1)])));
/** Id do fragmento de uma classe (E → frag_classe_e, SSR → frag_classe_ssr, Lendária → frag_classe_legendary). */
const fragmentOf = (rank) => `frag_classe_${String(rank).toLowerCase()}`;
const FRAGMENT_IDS = Object.freeze(RANKS.map(fragmentOf));

/** Só ARMA evolui por nível/estrelas (escudo, proteção e acessório ficam fora — decisão do plano). */
const isWeapon = (item) => !!item && item.category === "weapon" && !!item.slot;

const intIn = (v, lo, hi) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

/**
 * A PRÓXIMA tentativa da cópia: { rulesVersion, level, xp, need, powder, needs } ou null (não é arma, classe
 * desconhecida ou no teto). O pó é SEMPRE o da classe da arma.
 */
function refineCost(item, level, xp = 0) {
  if (!isWeapon(item) || !RANKS.includes(item.rank)) return null;
  const lv = intIn(level, 1, MAX_LEVEL);
  if (lv == null || lv >= MAX_LEVEL) return null;
  const powder = powderOf(item.rank);
  return { rulesVersion: RULES_VERSION, level: lv, xp: Math.max(0, Math.floor(Number(xp) || 0)), need: xpNeed(lv), powder, coins: 0, needs: { [powder]: 1 } };
}

/** Próxima estrela: { from, to, copies: 1 } ou null (no teto). Sempre sobe; o doador é uma cópia idêntica básica. */
function starsCost(item, stars) {
  if (!isWeapon(item)) return null;
  const from = intIn(stars, 1, MAX_STARS);
  if (from == null || from >= MAX_STARS) return null;
  return { rulesVersion: RULES_VERSION, from, to: from + 1, copies: 1 };
}

/**
 * Doador aceito: mesma arma, outra cópia, sem investimento — nível 1 sem XP e sem tentativa esperando, 1 estrela,
 * sem runa, sem despertar/ascensão/encanto, não travada e não vestida por nenhum personagem (vivo ou na
 * cápsula). Devolve null (serve) ou o código do motivo.
 */
function donorProblem(base, donor) {
  if (!donor) return "donor";
  if (donor.id === base.id) return "donorself";
  if (donor.item !== base.item) return "donoritem";
  if (donor.locked) return "pinned";
  if (donor.equippedBy) return "worn";
  const level = Number(donor.weaponLevel || 1);
  if (level > 1 || Number(donor.weaponXp || 0) > 0 || donor.weaponPending || Number(donor.grade || 1) > 1 || (donor.sockets || []).length || donor.ascended || donor.awakened || (donor.affixes && donor.affixes.enchant)) return "donorbuilt";
  return null;
}

/** Montar `item` por fragmentos: { fragment, need, rank } ou null (não é arma / classe sem fragmento). */
function assemblyCost(item) {
  if (!isWeapon(item) || !RANKS.includes(item.rank)) return null;
  return { rulesVersion: RULES_VERSION, rank: item.rank, fragment: fragmentOf(item.rank), need: FRAGMENT_NEED[item.rank] };
}

/** O nível como "plus" da régua (0…15, fracionário), contra a referência FIXA. */
function plusEquiv(level) {
  const n = Math.max(1, Math.min(LEVEL_REF, Number(level) || 1));
  return (B.PLUS_MAX * (n - 1)) / (LEVEL_REF - 1);
}

/** Conversão do +N de antes (forge-v2) para o nível novo: nunca rebaixa (plusEquiv(convert(N)) ≥ N). */
const levelFromPlus = (plus) => {
  const p = Math.max(0, Math.min(B.PLUS_MAX, Math.floor(Number(plus) || 0)));
  return Math.min(MAX_LEVEL, 1 + Math.ceil((p * (LEVEL_REF - 1)) / B.PLUS_MAX));
};

/** XP médio por tentativa: { all } (aceitando tudo) e { up } (aceitando só o que sobe, como o "10 vezes"). */
function expectedXp() {
  let all = 0, up = 0;
  for (const t of TIERS) { const m = (t.min + t.max) / 2; all += t.p * m; if (m > 0) up += t.p * m; }
  return { all, up };
}

/** Pós esperados para ir de `from` até `to` aceitando só o que sobe (matriz da economia). */
function expectedPowders(from = 1, to = MAX_LEVEL) {
  let xp = 0;
  for (let lv = Math.max(1, from); lv < Math.min(to, MAX_LEVEL); lv++) xp += xpNeed(lv);
  return Math.ceil(xp / expectedXp().up);
}

/** O que a tela precisa saber da regra (vai no catálogo público). */
const publicRules = () => ({
  rulesVersion: RULES_VERSION, maxLevel: MAX_LEVEL, maxStars: MAX_STARS, batch: BATCH,
  powders: POWDERS.map((p) => ({ id: p.id, rank: p.rank })),
  tiers: TIERS.map((t) => ({ id: t.id, p: t.p, min: t.min, max: t.max })),
  xpNeed: Array.from({ length: MAX_LEVEL - 1 }, (_, i) => xpNeed(i + 1)),
  fragmentNeed: FRAGMENT_NEED, fragments: Object.fromEntries(RANKS.map((r) => [r, fragmentOf(r)])),
});

module.exports = {
  RULES_VERSION, INSTANCE_RULES, MAX_LEVEL, LEVEL_REF, MAX_STARS, BATCH, POWDERS, POWDER_IDS, LEGACY_POWDERS, TIERS,
  FRAGMENT_NEED, FRAGMENT_IDS, fragmentOf, powderOf,
  isWeapon, xpNeed, rollXp, applyXp, refineCost, starsCost, donorProblem, assemblyCost, plusEquiv, levelFromPlus,
  expectedXp, expectedPowders, publicRules,
};
