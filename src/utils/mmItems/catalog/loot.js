// src/utils/mmItems/catalog/loot.js — SAQUE.
//
// Trilha E, fatia E3: TABELAS NOMEADAS por fonte (`fight:laminas`, `fight:boxe`, `minigame:<jogo>`;
// depois `mob:<tipo>`, `domain:<id>:<setor>`, `quest:<id>`, `chest:<id>`). Todo saque passa por
// `Items.rollTable` (regra pura) e `MeuMundoRewardService.grant` (porta única). As 7 famílias de
// antes foram escritas como tabelas com as MESMAS quantidades, chances e ordem de sorteio — o
// unit `meuMundoSaque.test.js` compara com a regra antiga em milhares de sorteios.
//
// Forma de uma tabela:
//   label    nome da fonte no "onde conseguir" (linha do garantido)
//   winLabel nome da fonte nas linhas de chance
//   sure     [{ id, qty }]            sempre (qty: [a, b] ou { byMinutes: true, win: n })
//   chance   [{ id, qty, p, win, note }] sorteio na ordem; `win: true` = só na vitória
//   first    [{ id, qty }]            só na primeira vitória (E12; `tb_mm_loot_first`, mig 449)
//   domain/sector  (E12) a tabela é um setor de Domínio: o "onde conseguir" agrupa os setores
// `win: true` também vale no `sure` (E12: o Domínio paga por vitória).
// `qty.byMinutes`: max(1, min(4, round(minutos ativos / 2))) + `win` se venceu (a regra de antes).
"use strict";

const { DOMAIN_NAME } = require("./lines");
const WP = require("../rules/weaponProgress");
const Chests = require("./chests");
const Bestiary = require("./bestiary");

// ── E12: o Domínio como masmorra (GDD, tabela L) ──
// Material comum por vitória = 1 + ⌊setor ÷ 3⌋ · raro = 5% + 3% × setor (garantido no chefão) ·
// Lingote do setor 4 · Catalisador do setor 8 · fragmento de conjunto (2 a 3) do 7 · chefão do 10:
// 3 a 5 fragmentos da arma de linha + 1 Selo + Essência (25%); primeira vitória: projeto no 7,
// 10 fragmentos + a receita no 10. A quantidade nunca cresce com o nível (§6.6).
const DOMAIN_SECTORS = 10;
const DOMAIN_MATS = Object.freeze({
  floresta: Object.freeze({ common: "po_de_lua", rare: "seiva_de_prata" }),
  canion: Object.freeze({ common: "areia_de_raio", rare: "pena_de_tempestade" }),
  gelo: Object.freeze({ common: "gelo_negro", rare: "perola_de_afogado" }),
  fabrica: Object.freeze({ common: "engrenagem_fina", rare: "coracao_de_corda" }),
  vulcao: Object.freeze({ common: "escoria", rare: "ferro_de_basalto" }),
  orbital: Object.freeze({ common: "vidro_colorido", rare: "prisma_vivo" }),
  vermelha: Object.freeze({ common: "folha_rubra", rare: "brasa_de_estandarte" }),
});
// weapon-v1 (24/11/2026): o Domínio paga a progressão nova das armas — pó da faixa do Domínio (o seguinte
// com chance; o chefão garante dois degraus acima) e fragmentos de classe do setor 7 em diante. Saíram a
// Pedra, o Catalisador, o Lingote, o Minério, o Cristal, a Essência, o Selo, as runas, os fragmentos de
// arma/conjunto específicos e os projetos (catalog/retired.js). A ordem é a dos níveis da porta.
const DOMAIN_ORDER = Object.freeze(["floresta", "canion", "gelo", "fabrica", "vulcao", "orbital", "vermelha"]);
/** Classes de fragmento do Domínio: [setores 7–9, chefão do 10]. */
const DOMAIN_FRAG = Object.freeze({
  floresta: ["C", "B"], canion: ["B", "A"], gelo: ["A", "S"], fabrica: ["S", "SS"],
  vulcao: ["SS", "SSR"], orbital: ["SSR", "legendary"], vermelha: ["legendary", "divine"],
});
const domainPowderQty = (sector) => 1 + Math.floor(sector / 4);
const domainNextPowder = (sector) => Math.round((0.1 + 0.03 * sector) * 100) / 100;
const domainCommonQty = (sector) => 1 + Math.floor(sector / 3);
const domainRareChance = (sector) => (5 + 3 * sector) / 100;

function domainTable(domain, sector) {
  const { common, rare } = DOMAIN_MATS[domain];
  const boss = sector === DOMAIN_SECTORS;
  const i = DOMAIN_ORDER.indexOf(domain);
  const powder = (k) => WP.POWDERS[Math.min(WP.POWDERS.length - 1, i + k)].id;
  const frag = (k) => WP.fragmentOf(DOMAIN_FRAG[domain][k]);
  const q = (n) => Object.freeze([n, n]);
  // o material do Domínio continua (Criogenia/bestiário e preparos usam)
  const sure = [{ id: common, qty: q(domainCommonQty(sector)), win: true }, { id: powder(0), qty: q(domainPowderQty(sector)), win: true }];
  if (boss) sure.push({ id: rare, qty: q(1), win: true }, { id: powder(2), qty: q(1), win: true }, { id: frag(1), qty: Object.freeze([3, 5]), win: true });
  else if (sector >= 7) sure.push({ id: frag(0), qty: Object.freeze([2, 3]), win: true });
  const chance = [];
  if (!boss) chance.push({ id: rare, qty: q(1), p: domainRareChance(sector), win: true });
  chance.push({ id: powder(1), qty: q(1), p: domainNextPowder(sector), win: true });
  const first = [];
  if (boss) first.push({ id: frag(1), qty: q(10) });
  else if (sector === 7) first.push({ id: frag(0), qty: q(10) });
  // S14: fragmentos de acessório, de personagem e do deus — sempre no FIM de cada lista
  const adds = Bestiary.domainAdds(domain, sector);
  sure.push(...adds.sure);
  chance.push(...adds.chance);
  first.push(...adds.first);
  const name = `Domínio ${DOMAIN_NAME[domain]}, setor ${sector}`;
  return Object.freeze({
    label: name, winLabel: name, domain, sector,
    sure: Object.freeze(sure.map(Object.freeze)), chance: Object.freeze(chance.map(Object.freeze)),
    ...(first.length ? { first: Object.freeze(first.map(Object.freeze)) } : {}),
  });
}
const DOMAIN_TABLES = Object.fromEntries(
  Object.keys(DOMAIN_MATS).flatMap((d) => Array.from({ length: DOMAIN_SECTORS }, (_, i) => [`domain:${d}:${i + 1}`, domainTable(d, i + 1)])),
);
/** Tabela do setor (`domain:<id>:<setor>`) ou null. */
const domainTableId = (domain, sector) => (DOMAIN_TABLES[`domain:${domain}:${sector}`] ? `domain:${domain}:${sector}` : null);

// ── E17: tabelas por atividade ──
// Tudo que entrou nas tabelas de antes foi para o FIM da lista (os sorteios de antes não mudam; a
// linha de quantidade fixa não sorteia). Fichas: `qty.tokens` (minutos ativos ÷ 2 + 1 se venceu).
const tokens = (game) => ({ id: `ficha_${game}`, qty: { tokens: true } });
// weapon-v1 (24/11/2026): Lâminas, rua e minijogos pagam Pó D/C e fragmentos das classes baixas; o material
// de forja de antes (fragmento de lâmina, núcleo, selo, pedra, minério, pigmento, mola, capacitor, rolamento) saiu.
const LAMINAS_SURE = [{ id: "po_ref_d", qty: { byMinutes: true, win: 1 } }];
const LAMINAS_CHANCE = [
  { id: "frag_classe_e", qty: [1, 2], p: 0.5, win: true },
  { id: "po_ref_c", qty: [1, 1], p: 0.35, win: true },
  { id: "frag_classe_d", qty: [1, 1], p: 0.25, win: true },
];
/** E17 (A9): o elite da rua é o monstro sorteado com fator ≥ 1,40 da régua (A15). */
const ELITE_FACTOR = 1.4;
const mobTable = (elite) => ({
  label: elite ? "Monstros de elite da rua" : "Monstros da rua", winLabel: elite ? "Vitórias contra elites da rua" : "Vitórias na rua",
  sure: [...LAMINAS_SURE, ...(elite ? [{ id: "frag_classe_c", qty: [2, 3], win: true }, { id: "po_ref_b", qty: [1, 1], win: true }] : [])],
  chance: [...LAMINAS_CHANCE, { id: "po_forja", qty: [1, 1], p: 0.3 }, ...(elite ? [{ id: "frag_classe_legendary", qty: [1, 1], p: 0.08, win: true }] : [])],
  ...(elite ? { first: [{ id: "frag_classe_legendary", qty: [3, 3] }] } : {}),
});
/** Minijogo: ficha, Pó D, chance de fragmento D, Pó de Forja (e Madeira na Antigravidade e na Gincana). */
const minigame = (label, game, base, extra = {}) => ({
  label,
  sure: [...(base ? [{ id: base, qty: { byMinutes: true, win: 1 } }] : []), tokens(game), { id: "po_ref_d", qty: [1, 2] }, ...(extra.sure || [])],
  chance: [{ id: "po_forja", qty: [1, 1], p: 0.3 }, ...(extra.wood ? [{ id: "madeira_ancestral", qty: [1, 1], p: 0.25 }] : []), { id: "frag_classe_d", qty: [1, 1], p: 0.3, win: true }, ...(extra.chance || [])],
  ...(extra.first ? { first: extra.first } : {}),
});

const TABLES = Object.freeze({
  "fight:laminas": {
    label: "Lâminas e monstros", winLabel: "Vitórias da família forja",
    // E17: o Pó de Forja garantido (quantidade fixa: não sorteia)
    sure: [...LAMINAS_SURE, { id: "po_forja", qty: [1, 1] }],
    chance: [...LAMINAS_CHANCE, { id: "frag_classe_legendary", qty: [1, 1], p: 0.05, win: true }],
    first: [{ id: "frag_classe_c", qty: [5, 5] }],
  },
  "fight:boxe": {
    label: "Boxe", winLabel: "Vitórias do Boxe",
    sure: [{ id: "couro_reforcado", qty: { byMinutes: true, win: 1 } }],
    chance: [
      { id: "po_ref_d", qty: [1, 1], p: 0.5, win: true },
      { id: "frag_classe_e", qty: [1, 1], p: 0.3, win: true },
    ],
  },
  // E17 (A10): o Hall é PvP — só ficha (a troca do Hall vende o caminho de Aurion)
  "fight:hall": { label: "Hall dos Campeões", sure: [tokens("hall")] },
  "mob:common": mobTable(false),
  "mob:elite": mobTable(true),
  "minigame:paint": minigame("Paint", "paint", null, {
    sure: [{ id: "frag_classe_c", qty: [1, 2], win: true }],
    first: [{ id: "frag_classe_b", qty: [5, 5] }],
  }),
  "minigame:gincana": minigame("Gincana", "gincana", null, { wood: true }),
  "minigame:jetpack": minigame("Jetpack", "jetpack", "injetor_vapor"),
  "minigame:corrida": minigame("Antigravidade", "corrida", null, { wood: true }),
  "minigame:noturno": minigame("Rolê Noturno", "noturno", null, { chance: [{ id: "po_ref_c", qty: [1, 1], p: 0.25, win: true }] }),
  ...DOMAIN_TABLES,
  // E18: baús (conteúdo fixo, uma vez por conta)
  ...Chests.TABLES,
});

/** Atividade (Adv.ACTIVITIES) → tabela. Luta: Lâminas/rua/Domínio = laminas; Boxe = boxe. */
const ACTIVITY_TABLE = Object.freeze({
  laminas: "fight:laminas",
  boxe: "fight:boxe",
  paint: "minigame:paint",
  gincana: "minigame:gincana",
  jetpack: "minigame:jetpack",
  corrida: "minigame:corrida",
  noturno: "minigame:noturno",
});

/**
 * Família de antes (meuMundoGear.LOOT, ainda exportada pela fachada) → material comum, incomum e
 * raro. Mantida igual para quem lê `Gear.LOOT`; a regra é a das tabelas acima.
 */
const LOOT = Object.freeze({
  // weapon-v1: o material comum de cada família agora é o Pó de Refinamento D (couro e vapor seguem: preparos)
  forja: { base: "po_ref_d", uncommon: "po_ref_c", rare: null },
  couro: { base: "couro_reforcado", uncommon: "po_ref_d", rare: null },
  pigmento: { base: "po_ref_d", uncommon: null, rare: null },
  mola: { base: "po_ref_d", uncommon: null, rare: null },
  vapor: { base: "injetor_vapor", uncommon: null, rare: null },
  capacitor: { base: "po_ref_d", uncommon: null, rare: null },
  rolamento: { base: "po_ref_d", uncommon: null, rare: null },
});
/** Família de antes → tabela (para `Gear.rollLoot(family, …)`, que segue existindo). */
const FAMILY_TABLE = Object.freeze({
  forja: "fight:laminas",
  couro: "fight:boxe",
  pigmento: "minigame:paint",
  mola: "minigame:gincana",
  vapor: "minigame:jetpack",
  capacitor: "minigame:corrida",
  rolamento: "minigame:noturno",
});

module.exports = { TABLES, ACTIVITY_TABLE, LOOT, FAMILY_TABLE, DOMAIN_SECTORS, DOMAIN_MATS, DOMAIN_ORDER, DOMAIN_FRAG, ELITE_FACTOR, domainCommonQty, domainRareChance, domainTableId };
