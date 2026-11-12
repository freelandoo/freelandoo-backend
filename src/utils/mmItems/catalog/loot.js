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

const { DOMAIN_NAME, LINES, FRAGMENT_SETS, BOSS_FRAGMENTS, SET_FRAGMENTS } = require("./lines");
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
});
/** E13: a runa de cada Domínio (a de Acuracidade cai em todos, mais rara). */
const DOMAIN_RUNE = Object.freeze({ floresta: "destreza", canion: "velocidade", gelo: "vitalidade", fabrica: "defesa", vulcao: "ataque", orbital: "inteligencia" });
const RUNE_CHANCE = Object.freeze({ domain: 0.2, forca: 0.05, boss: 0.35 });
const domainCommonQty = (sector) => 1 + Math.floor(sector / 3);
const domainRareChance = (sector) => (5 + 3 * sector) / 100;

function domainTable(domain, sector) {
  const { common, rare } = DOMAIN_MATS[domain];
  const set = FRAGMENT_SETS.find((x) => x.domain === domain);
  const line = LINES.find((l) => l.region === domain);
  const boss = sector === DOMAIN_SECTORS;
  const q = (n) => Object.freeze([n, n]);
  const sure = [{ id: common, qty: q(domainCommonQty(sector)), win: true }];
  if (boss) sure.push({ id: rare, qty: q(1), win: true });
  if (set && sector >= 7) sure.push({ id: `frag_${set.id}`, qty: SET_FRAGMENTS.qty, win: true });
  if (boss) sure.push({ id: `frag_${line.key}`, qty: BOSS_FRAGMENTS.qty, win: true }, { id: "selo_dominio", qty: q(1), win: true });
  const chance = [];
  if (!boss) chance.push({ id: rare, qty: q(1), p: domainRareChance(sector), win: true });
  chance.push(
    { id: "pedra_aprimoramento", qty: q(1), p: 0.5, win: true },
    { id: "minerio_prata", qty: q(1), p: 0.2, win: true },
    { id: "cristal_bruto", qty: q(1), p: 0.15, win: true },
  );
  if (sector >= 4) chance.push({ id: "lingote_refinado", qty: q(1), p: 0.25, win: true });
  if (sector >= 8) chance.push({ id: "catalisador_refino", qty: q(1), p: 0.1, win: true });
  if (boss) chance.push({ id: "essencia_primordial", qty: q(1), p: 0.25, win: true });
  // E13: runas no FIM da lista (os sorteios de antes não mudam): a do Domínio (grau I em todo setor,
  // grau II no chefão) e a de Acuracidade (rara, em todo Domínio)
  chance.push({ id: `runa_${DOMAIN_RUNE[domain]}_1`, qty: q(1), p: RUNE_CHANCE.domain, win: true }, { id: "runa_forca_1", qty: q(1), p: RUNE_CHANCE.forca, win: true });
  if (boss) chance.push({ id: `runa_${DOMAIN_RUNE[domain]}_2`, qty: q(1), p: RUNE_CHANCE.boss, win: true });
  const first = [];
  if (set && sector === 7) first.push({ id: `projeto_${set.id}`, qty: q(1) });
  if (boss) first.push({ id: `frag_${line.key}`, qty: q(BOSS_FRAGMENTS.first) }, { id: `receita_${line.key}`, qty: q(1) });
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

const TABLES = Object.freeze({
  "fight:laminas": {
    label: "Lâminas e monstros", winLabel: "Vitórias da família forja",
    sure: [{ id: "fragmento_lamina", qty: { byMinutes: true, win: 1 } }],
    chance: [
      { id: "nucleo_eter", qty: [1, 1], p: 0.35, win: true, note: "há condensação garantida no ferreiro" },
      { id: "selo_forja", qty: [1, 1], p: 0.06, win: true, note: "há certificação garantida no ferreiro" },
      // E9: a Pedra paga o aprimoramento garantido (GDD, tabela L); no fim da lista, para não mexer nos sorteios de antes
      { id: "pedra_aprimoramento", qty: [1, 1], p: 0.5, win: true, note: "paga o aprimoramento garantido" },
    ],
  },
  "fight:boxe": {
    label: "Boxe", winLabel: "Vitórias do Boxe",
    sure: [{ id: "couro_reforcado", qty: { byMinutes: true, win: 1 } }],
    chance: [
      { id: "rebite", qty: [1, 1], p: 0.35, win: true, note: "também pode ser produzido no ferreiro" },
      { id: "pedra_aprimoramento", qty: [1, 1], p: 0.5, win: true, note: "paga o aprimoramento garantido" }, // E9
    ],
  },
  "minigame:paint": { label: "Paint", sure: [{ id: "pigmento_eter", qty: { byMinutes: true, win: 1 } }] },
  "minigame:gincana": { label: "Gincana", sure: [{ id: "mola_precisao", qty: { byMinutes: true, win: 1 } }] },
  "minigame:jetpack": { label: "Jetpack", sure: [{ id: "injetor_vapor", qty: { byMinutes: true, win: 1 } }] },
  "minigame:corrida": { label: "Antigravidade", sure: [{ id: "capacitor", qty: { byMinutes: true, win: 1 } }] },
  "minigame:noturno": { label: "Rolê Noturno", sure: [{ id: "rolamento", qty: { byMinutes: true, win: 1 } }] },
  ...DOMAIN_TABLES,
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
  forja: { base: "fragmento_lamina", uncommon: "nucleo_eter", rare: "selo_forja" },
  couro: { base: "couro_reforcado", uncommon: "rebite", rare: null },
  pigmento: { base: "pigmento_eter", uncommon: null, rare: null },
  mola: { base: "mola_precisao", uncommon: null, rare: null },
  vapor: { base: "injetor_vapor", uncommon: null, rare: null },
  capacitor: { base: "capacitor", uncommon: null, rare: null },
  rolamento: { base: "rolamento", uncommon: null, rare: null },
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

module.exports = { TABLES, ACTIVITY_TABLE, LOOT, FAMILY_TABLE, DOMAIN_SECTORS, DOMAIN_MATS, DOMAIN_RUNE, RUNE_CHANCE, domainCommonQty, domainRareChance, domainTableId };
