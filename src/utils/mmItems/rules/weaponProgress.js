// src/utils/mmItems/rules/weaponProgress.js — ARMAS: NÍVEL 1–90, PÓ POR FAIXA, ESTRELAS E FRAGMENTOS DE CLASSE
// (weapon-v1, 24/11/2026). Regra pura, sem banco. Plano: MEU MUNDO 3D/planos/2026-11-24-armas-refino-forja.md.
//
// Três eixos que NÃO se misturam:
//   • classe da arma (`rank`: E…SSR, Lendária, Divina) — do catálogo, nunca muda;
//   • NÍVEL da cópia (1…MAX_LEVEL) — sobe na bancada de refinamento, 1 pó por tentativa, pode falhar;
//   • ESTRELAS da cópia (1…MAX_STARS) — sobem na forja consumindo uma cópia IDÊNTICA (mesmo item), sempre.
// Fragmentos são da CLASSE: com FRAGMENT_NEED[classe] o jogador escolhe QUAL arma daquela classe montar.
//
// O pó é escolhido pelo nível de DESTINO (9→10 usa D; 10→11 usa C; 60→61 usa SSS I…). Falha consome o
// pó e mantém a arma como estava (não cai, não quebra). Sem pity, sem proteção paga, sem proposta.
//
// Bônus: o nível ocupa a fatia `plus` da régua (budget.SHARE.plus) contra uma REFERÊNCIA FIXA
// (LEVEL_REF = 90): subir o teto no futuro nunca rebaixa o que já foi conquistado (a fatia de quem passar
// do 90 precisa de subteto novo: aí se versiona RULES_VERSION). As estrelas ocupam a fatia `grade`
// (armazenadas na coluna `grade` da instância: 1 estrela = grau I … 5 estrelas = grau V).
"use strict";

const B = require("./budget");
const { RANKS } = require("./rank");

const RULES_VERSION = "weapon-v1";
/** Teto de negócio de hoje (o banco aceita até 999: chk_mm_instance_weapon_level, mig 466). */
const MAX_LEVEL = 90;
/** Referência fixa do bônus (não acompanha MAX_LEVEL). */
const LEVEL_REF = 90;
const MAX_STARS = B.GRADE_MAX; // 5

/**
 * Os 9 pós. `upTo` = último nível de destino da faixa; `chance` = sucesso de cada tentativa da faixa.
 * Proposta inicial (registrada como pressuposto no plano): cai por faixa, SSS entra no avanço 60→61.
 */
const POWDERS = Object.freeze([
  { id: "po_ref_d", name: "Pó de Refinamento D", upTo: 10, chance: 1, rarity: "common" },
  { id: "po_ref_c", name: "Pó de Refinamento C", upTo: 20, chance: 0.95, rarity: "common" },
  { id: "po_ref_b", name: "Pó de Refinamento B", upTo: 30, chance: 0.9, rarity: "uncommon" },
  { id: "po_ref_a", name: "Pó de Refinamento A", upTo: 40, chance: 0.8, rarity: "uncommon" },
  { id: "po_ref_s", name: "Pó de Refinamento S", upTo: 50, chance: 0.7, rarity: "rare" },
  { id: "po_ref_ss", name: "Pó de Refinamento SS", upTo: 60, chance: 0.6, rarity: "epic" },
  { id: "po_ref_sss1", name: "Pó de Refinamento SSS I", upTo: 70, chance: 0.45, rarity: "legendary" },
  { id: "po_ref_sss2", name: "Pó de Refinamento SSS II", upTo: 80, chance: 0.3, rarity: "legendary" },
  { id: "po_ref_sss3", name: "Pó de Refinamento SSS III", upTo: 90, chance: 0.2, rarity: "mythic" },
].map(Object.freeze));
const POWDER_IDS = Object.freeze(POWDERS.map((p) => p.id));

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

/** A faixa do nível de DESTINO (2…MAX_LEVEL) ou null. */
function bandFor(toLevel) {
  const to = intIn(toLevel, 2, MAX_LEVEL);
  if (to == null) return null;
  return POWDERS.find((p) => to <= p.upTo) || null;
}

/** Custo e chance da PRÓXIMA tentativa: { rulesVersion, from, to, powder, chance, coins: 0, needs } ou null (no teto). */
function refineCost(item, level) {
  if (!isWeapon(item)) return null;
  const from = intIn(level, 1, MAX_LEVEL);
  if (from == null || from >= MAX_LEVEL) return null;
  const band = bandFor(from + 1);
  return { rulesVersion: RULES_VERSION, from, to: from + 1, powder: band.id, chance: band.chance, coins: 0, needs: { [band.id]: 1 } };
}

/**
 * Um sorteio já feito (`r` em [0,1), do servidor): sucesso quando r < chance. O número que saiu vai no
 * recibo e na tela ("saiu 59,56%; números menores que 55% vencem").
 */
const rollWins = (r, chance) => Number(r) < Number(chance);

/** Próxima estrela: { from, to, copies: 1 } ou null (no teto). Sempre sobe; o doador é uma cópia idêntica básica. */
function starsCost(item, stars) {
  if (!isWeapon(item)) return null;
  const from = intIn(stars, 1, MAX_STARS);
  if (from == null || from >= MAX_STARS) return null;
  return { rulesVersion: RULES_VERSION, from, to: from + 1, copies: 1 };
}

/**
 * Doador aceito na v1 (proposta do plano): mesma arma, outra cópia, sem investimento — nível 1, 1 estrela,
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
  if (level > 1 || Number(donor.grade || 1) > 1 || (donor.sockets || []).length || donor.ascended || donor.awakened || (donor.affixes && donor.affixes.enchant)) return "donorbuilt";
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

/** Custo esperado de um nível com chance p (1 pó por tentativa): 1/p. Para a matriz da economia. */
const expectedPowder = (chance) => (chance > 0 ? 1 / chance : Infinity);

/** Gasto esperado de pó, por faixa, de 1 até `to`. */
function expectedTotal(to = MAX_LEVEL) {
  const out = Object.fromEntries(POWDER_IDS.map((id) => [id, 0]));
  for (let lv = 2; lv <= Math.min(to, MAX_LEVEL); lv++) {
    const b = bandFor(lv);
    out[b.id] += expectedPowder(b.chance);
  }
  for (const id of Object.keys(out)) out[id] = Math.round(out[id] * 10) / 10;
  return out;
}

/** O que a tela precisa saber da regra (vai no catálogo público). */
const publicRules = () => ({
  rulesVersion: RULES_VERSION, maxLevel: MAX_LEVEL, maxStars: MAX_STARS,
  powders: POWDERS.map((p, i) => ({ id: p.id, from: i === 0 ? 2 : POWDERS[i - 1].upTo + 1, upTo: p.upTo, chance: p.chance })),
  fragmentNeed: FRAGMENT_NEED, fragments: Object.fromEntries(RANKS.map((r) => [r, fragmentOf(r)])),
});

module.exports = {
  RULES_VERSION, MAX_LEVEL, LEVEL_REF, MAX_STARS, POWDERS, POWDER_IDS, FRAGMENT_NEED, FRAGMENT_IDS, fragmentOf,
  isWeapon, bandFor, refineCost, rollWins, starsCost, donorProblem, assemblyCost, plusEquiv, levelFromPlus,
  expectedPowder, expectedTotal, publicRules,
};
