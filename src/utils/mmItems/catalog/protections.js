// src/utils/mmItems/catalog/protections.js — PROTEÇÕES POR FRAGMENTO (24/11/2026, regra nova do Alex).
//
// "Não existe mais fabricação por material: tudo por FRAGMENTO." Toda peça de proteção que a Forja faz
// tem o seu fragmento `frag_<id da peça>` e a receita pede só esses fragmentos (+ moedas, + nível):
//   • 52 peças novas em 13 conjuntos de E a Divina (elmo, peitoral, luvas, botas) — ids, nomes, classes e
//     origens combinados com a sessão das artes (`MEU MUNDO 3D/arte/protecoes-gpt/protecoes.json`);
//   • as 17 peças de antes (colete, couraça, óculos, luvas, botas e os conjuntos Vigília/Forja/Sentinela).
// Fragmentos para fabricar, pela classe da peça: E 20 · D 30 · C 40 · B 50 · A 70 · S 90 · SS 120 ·
// SSR 150 · Lendária 180 · Divina 200. O que sobrar vira Pó de Refino (como os fragmentos de amuleto).
// As linhas de saque entram no FIM de cada lista das tabelas (catalog/loot.js): os sorteios de antes não mudam.
// 24/11/2026 (Alex, "quero tudo pra poder comprar"): toda proteção também se COMPRA — com o Forjador, pelo preço
// da classe (rules/classStats PRICE, a mesma régua das espadas e cajados). Reciclar segue sem moeda (a Forja monta
// por poucas moedas: pagar a reciclagem viraria lucro). A Forja segue igual.
"use strict";

const { G } = require("./_base");
const { PRICE } = require("../rules/classStats");
const { slotKeys } = require("../rules/budget");
const { DOMAIN_NAME, powderPerFragment } = require("./lines");

const NEED = Object.freeze({ E: 20, D: 30, C: 40, B: 50, A: 70, S: 90, SS: 120, SSR: 150, legendary: 180, divine: 200 });
const COINS = Object.freeze({ E: 100, D: 200, C: 350, B: 500, A: 700, S: 900, SS: 1300, SSR: 1800, legendary: 2500, divine: 3500 });
const LEVEL = Object.freeze({ E: 1, D: 3, C: 5, B: 9, A: 13, S: 17, SS: 21, SSR: 25, legendary: 27, divine: 29 });
/** Tier do pó por fragmento que sobra (régua de lines.powderPerFragment). */
const POWDER_TIER = Object.freeze({ E: 1, D: 2, C: 2, B: 3, A: 3, S: 4, SS: 4, SSR: 4, legendary: 5, divine: 6 });
const RANK_NAME = Object.freeze({ legendary: "Lendária", divine: "Divina" });
const SLOTS = Object.freeze([["elmo", "helm"], ["peitoral", "chest"], ["luvas", "gloves"], ["botas", "boots"]]);

// ── os 13 conjuntos novos (nomes da sessão das artes). `focus` escolhe as 2 chaves de cada slot ──
const NEW_SETS = Object.freeze([
  { id: "aprendiz", rank: "E", rarity: "common", focus: ["def", "hp", "stam", "dex", "spd"], names: ["Elmo do Aprendiz", "Peitoral do Aprendiz", "Luvas do Aprendiz", "Botas do Aprendiz"], where: "monstros comuns da rua" },
  { id: "latao", rank: "D", rarity: "uncommon", focus: ["def", "stam", "hp", "dex", "spd"], names: ["Elmo de Latão", "Peitoral de Latão", "Luvas de Latão", "Botas de Latão"], where: "setores 1 a 3 de qualquer Domínio e elites da rua" },
  { id: "eter", rank: "C", rarity: "uncommon", focus: ["int", "warn", "stam", "acc", "spd"], names: ["Elmo de Éter", "Peitoral de Éter", "Luvas de Éter", "Botas de Éter"], where: "setores 3 a 6 de qualquer Domínio" },
  { id: "tempestade", rank: "A", rarity: "rare", focus: ["spd", "dex", "acc", "dmg", "hp"], names: ["Elmo da Tempestade", "Peitoral da Tempestade", "Luvas da Tempestade", "Botas da Tempestade"], where: "Cânion das Tempestades, setores 7 a 10" },
  { id: "gelo", rank: "S", rarity: "epic", focus: ["hp", "def", "stam", "warn", "spd"], names: ["Elmo do Gelo Eterno", "Peitoral do Gelo Eterno", "Luvas do Gelo Eterno", "Botas do Gelo Eterno"], where: "Mar de Gelo, setores 6 a 10" },
  { id: "orbital", rank: "SS", rarity: "epic", focus: ["int", "acc", "spd", "warn", "stam"], names: ["Elmo Orbital", "Peitoral Orbital", "Luvas Orbital", "Botas Orbital"], where: "chefe final da Cidade Orbital (setor 10)" },
  { id: "dragao", rank: "SSR", rarity: "epic", focus: ["dmg", "hp", "def", "acc", "stam"], names: ["Elmo do Dragão Rubro", "Peitoral do Dragão Rubro", "Luvas do Dragão Rubro", "Botas do Dragão Rubro"], where: "Kragor, chefe final do Vulcão (setor 10)" },
  { id: "aurion", rank: "legendary", rarity: "legendary", focus: ["dmg", "acc", "hp", "dex", "spd"], names: ["Elmo da Primeira Chama", "Peitoral da Primeira Chama", "Luvas da Primeira Chama", "Botas da Primeira Chama"], where: "Arena das Lâminas (monstro nível 27+) e troca do Hall" },
  { id: "morkhan", rank: "legendary", rarity: "legendary", focus: ["dmg", "dex", "warn", "stam", "def"], names: ["Elmo das Correntes", "Peitoral das Correntes", "Luvas das Correntes", "Botas das Correntes"], where: "elites da rua de nível 27+" },
  { id: "zephyra", rank: "legendary", rarity: "legendary", focus: ["spd", "dex", "stam", "acc", "int"], names: ["Elmo do Vendaval", "Peitoral do Vendaval", "Luvas do Vendaval", "Botas do Vendaval"], where: "Zéphyra, deusa do Cânion (setor 10)" },
  { id: "bastor", rank: "legendary", rarity: "legendary", focus: ["hp", "stam", "dex", "int", "def"], names: ["Elmo dos Moldes", "Peitoral dos Moldes", "Luvas dos Moldes", "Botas dos Moldes"], where: "chefão da Fábrica (setor 10) e 1º lugar da semana no Paint" },
  { id: "ceu", rank: "divine", rarity: "mythic", focus: ["int", "warn", "hp", "spd", "acc"], names: ["Elmo do Céu", "Peitoral do Céu", "Luvas do Céu", "Botas do Céu"], where: "deuses de todos os Domínios (setor 10)" },
  { id: "pira", rank: "divine", rarity: "mythic", focus: ["dmg", "def", "hp", "dex", "stam"], names: ["Elmo da Pira", "Peitoral da Pira", "Luvas da Pira", "Botas da Pira"], where: "chefes finais de todos os Domínios (setor 10)" },
]);
const SET_BY_ID = new Map(NEW_SETS.map((s) => [s.id, s]));

/** As 2 chaves do slot pela ordem de preferência do conjunto (completa com as do slot). */
function keysFor(focus, slot) {
  const ok = slotKeys(slot);
  const keys = focus.filter((k) => ok.includes(k)).slice(0, 2);
  for (const k of ok) if (keys.length < 2 && !keys.includes(k)) keys.push(k);
  return Object.freeze(keys);
}

const NEW_PIECES = NEW_SETS.flatMap((s) => SLOTS.map(([word, slot], n) => G(`${s.id}_${word}`, "armor", s.names[n], s.rarity, {
  slot, rank: s.rank, keys: keysFor(s.focus, slot), level: LEVEL[s.rank], price: PRICE[s.rank], sell: 0 /* reciclar não paga: a Forja monta por poucas moedas */, group: s.id,
})));

// ── as 17 peças de antes que a Forja passa a fazer (id → classe; a peça continua no catálogo dela) ──
const OLD = Object.freeze({
  colete_couro: "E", couraca_rebitada: "D", oculos_engenheiro: "D", luvas_precisao: "D", botas_explorador: "D",
  ...Object.fromEntries(["vigilia", "forja", "sentinela"].flatMap((s) => SLOTS.map(([w]) => [`${s}_${w}`, "B"]))),
});
const OLD_INFO = Object.freeze({
  colete_couro: { name: "Colete de couro", rarity: "common", where: "Boxe" },
  couraca_rebitada: { name: "Couraça rebitada", rarity: "uncommon", where: "Boxe" },
  oculos_engenheiro: { name: "Óculos do engenheiro", rarity: "uncommon", where: "Rolê Noturno" },
  luvas_precisao: { name: "Luvas de precisão", rarity: "uncommon", where: "Gincana" },
  botas_explorador: { name: "Botas do explorador", rarity: "uncommon", where: "Antigravidade" },
});
const SET_NAME = Object.freeze({ vigilia: "da Vigília", forja: "da Forja", sentinela: "da Sentinela de Bronze" });
const SET_DOMAIN = Object.freeze({ vigilia: "floresta", forja: "vulcao", sentinela: "fabrica" });
const SET_PIECE_NAME = Object.freeze({ elmo: "Elmo", peitoral: "Peitoral", luvas: "Luvas", botas: "Botas" });
const SET_PIECE_LEVEL = Object.freeze({ floresta: 5, fabrica: 17, vulcao: 21 });

function oldInfo(id) {
  if (OLD_INFO[id]) return OLD_INFO[id];
  const [set, word] = id.split("_");
  return { name: `${SET_PIECE_NAME[word]} ${SET_NAME[set]}`, rarity: "rare", where: `Domínio ${DOMAIN_NAME[SET_DOMAIN[set]]}, setores 7 a 9`, level: SET_PIECE_LEVEL[SET_DOMAIN[set]] };
}

/** Todas as peças que a Forja faz: { id, name, rank, rarity, level, where }. */
const FORGEABLE = Object.freeze([
  ...NEW_PIECES.map((p) => Object.freeze({ id: p.id, name: p.name, rank: p.rank, rarity: p.rarity, level: p.level, where: SET_BY_ID.get(p.group).where })),
  ...Object.entries(OLD).map(([id, rank]) => {
    const o = oldInfo(id);
    return Object.freeze({ id, name: o.name, rank, rarity: o.rarity, level: o.level || LEVEL[rank], where: o.where });
  }),
]);

const FRAGMENT_ITEMS = FORGEABLE.map((p) => G(`frag_${p.id}`, "fragment", `Fragmento: ${p.name}`, p.rarity, {
  stack: true, sell: 0, rank: p.rank,
  fragment: Object.freeze({ of: p.id, need: NEED[p.rank], powder: powderPerFragment(POWDER_TIER[p.rank]), forge: true }),
}));

const RECIPES = Object.freeze(FORGEABLE.map((p) => Object.freeze({
  id: `fragmentos_${p.id}`, kind: "fragment", out: p.id, qty: 1,
  needs: Object.freeze({ [`frag_${p.id}`]: NEED[p.rank] }), coins: COINS[p.rank], level: p.level, keep: true,
})));

const rankLabel = (r) => RANK_NAME[r] || r;
const DESCRIPTIONS = Object.freeze({
  ...Object.fromEntries(NEW_PIECES.map((p) => [p.id, `Proteção de classe ${rankLabel(p.rank)}. Fabricada na Forja com ${NEED[p.rank]} fragmentos.`])),
  ...Object.fromEntries(FORGEABLE.map((p) => [`frag_${p.id}`, `Junte ${NEED[p.rank]} para fabricar ${p.name} na Forja. Cai em: ${p.where}. O que sobrar vira Pó de Refino.`])),
});

// ── origem dos fragmentos (linhas no FIM das listas; `p` = chance por vitória, por peça) ──
const ids = (set) => SLOTS.map(([w]) => `frag_${set}_${w}`);
const chanceOf = (set, p, qty, extra = {}) => ids(set).map((id) => ({ id, qty: Object.freeze(qty), p, win: true, ...extra }));
// legend-v1: Lendário fora dos Domínios só contra monstro de nível 27+ (catalog/weekPrize.js)
const LEGEND = Object.freeze({ minLevel: 27, note: "só contra monstro de nível 27 ou mais" });
const sureOf = (set, qty) => ids(set).map((id) => ({ id, qty: Object.freeze(qty), win: true }));
const firstOf = (set, n) => ids(set).map((id) => ({ id, qty: Object.freeze([n, n]) }));
const one = (id, p, qty) => ({ id: `frag_${id}`, qty: Object.freeze(qty), p, win: true });

/** Tabelas fora dos Domínios: o que cada uma ganha no fim. */
const TABLE_ADDS = Object.freeze({
  "mob:common": { chance: chanceOf("aprendiz", 0.35, [1, 3]) },
  "mob:elite": { chance: [...chanceOf("aprendiz", 0.35, [1, 3]), ...chanceOf("latao", 0.25, [1, 2]), ...chanceOf("morkhan", 0.04, [1, 2], LEGEND)] },
  "fight:laminas": { chance: chanceOf("aurion", 0.04, [1, 2], LEGEND) },
  "fight:boxe": { chance: [one("colete_couro", 0.25, [1, 2]), one("couraca_rebitada", 0.2, [1, 2])] },
  "minigame:gincana": { chance: [one("luvas_precisao", 0.25, [1, 2])] },
  "minigame:corrida": { chance: [one("botas_explorador", 0.25, [1, 2])] },
  "minigame:noturno": { chance: [one("oculos_engenheiro", 0.25, [1, 2])] },
});
const OLD_SET_DOMAIN = Object.freeze({ floresta: "vigilia", vulcao: "forja", fabrica: "sentinela" });

/** O que o setor do Domínio ganha no fim (lido por domainTable, depois do bestiário). */
function domainAdds(domain, sector) {
  const sure = [], chance = [], first = [];
  if (sector <= 3) chance.push(...chanceOf("latao", 0.3, [1, 2]));
  if (sector >= 3 && sector <= 6) chance.push(...chanceOf("eter", 0.3, [1, 3]));
  if (OLD_SET_DOMAIN[domain] && sector >= 7 && sector <= 9) chance.push(...chanceOf(OLD_SET_DOMAIN[domain], 0.3, [1, 2]));
  if (domain === "canion" && sector >= 7) chance.push(...chanceOf("tempestade", 0.4, [2, 3]));
  if (domain === "gelo" && sector >= 6) chance.push(...chanceOf("gelo", 0.4, [2, 3]));
  if (sector === 10) {
    if (domain === "orbital") { sure.push(...sureOf("orbital", [3, 5])); first.push(...firstOf("orbital", 10)); }
    if (domain === "vulcao") { chance.push(...chanceOf("dragao", 0.5, [3, 5])); first.push(...firstOf("dragao", 10)); }
    if (domain === "canion") { chance.push(...chanceOf("zephyra", 0.25, [1, 2])); first.push(...firstOf("zephyra", 5)); }
    // legend-v1: o Bastor saiu da partida do Paint — cai no chefão da Fábrica e vai para o 1º lugar da semana do Paint
    if (domain === "fabrica") chance.push(...chanceOf("bastor", 0.25, [1, 2]));
    chance.push(...chanceOf("ceu", 0.06, [1, 1]), ...chanceOf("pira", 0.04, [1, 2]));
    first.push(...firstOf("ceu", 3));
  }
  return { sure, chance, first };
}

/** Hall (PvP): a troca vende os fragmentos de Aurion (o caminho da Primeira Chama). */
const HALL_OFFERS = Object.freeze(ids("aurion").map((id) => Object.freeze({ id, cost: 45, qty: 3 })));

module.exports = {
  NEED, COINS, LEVEL, NEW_SETS, FORGEABLE, RECIPES, DESCRIPTIONS, TABLE_ADDS, HALL_OFFERS, domainAdds,
  ITEMS: Object.freeze([...NEW_PIECES, ...FRAGMENT_ITEMS]),
};
