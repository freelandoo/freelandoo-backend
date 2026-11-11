// src/utils/mmItems/catalog/sets.js — CONJUNTOS de 4 peças (trilha E, fatia E7).
//
// Três conjuntos raros, um por Domínio (§7 do plano e GDD): Vigília (Floresta da Lua, def + hp),
// Forja (Vulcão, dmg + power) e Sentinela de Bronze (Fábrica, def + stam). Cada um tem elmo,
// peitoral, luvas e botas; as duas chaves de cada peça saem do slot (o que o conjunto pede e cabe;
// senão a reserva do GDD). Bônus do conjunto (rules/bonus.js): 2 ou 3 peças = 40% da fatia de
// conjunto (10% do teto) nas duas chaves do conjunto; 4 peças = 100%.
// As peças ainda não caem em lugar nenhum: os fragmentos e o projeto chegam com a E8 e o saque
// dos setores 7 a 10 com a E12 (por isso a origem escrita aqui).
"use strict";

const { G } = require("./_base");

const SETS = Object.freeze([
  Object.freeze({ id: "vigilia", name: "Vigília", domain: "floresta", keys: Object.freeze(["def", "hp"]), pieces: Object.freeze(["vigilia_elmo", "vigilia_peitoral", "vigilia_luvas", "vigilia_botas"]) }),
  Object.freeze({ id: "forja", name: "Forja", domain: "vulcao", keys: Object.freeze(["dmg", "power"]), pieces: Object.freeze(["forja_elmo", "forja_peitoral", "forja_luvas", "forja_botas"]) }),
  Object.freeze({ id: "sentinela", name: "Sentinela de Bronze", domain: "fabrica", keys: Object.freeze(["def", "stam"]), pieces: Object.freeze(["sentinela_elmo", "sentinela_peitoral", "sentinela_luvas", "sentinela_botas"]) }),
]);

/** Fração da fatia de conjunto por nº de peças equipadas (0, 1 = nada; 2–3 = 40%; 4 = 100%). */
const SET_STEPS = Object.freeze({ 2: 0.4, 3: 0.4, 4: 1 });

const DOMAIN_NAME = Object.freeze({ floresta: "Floresta da Lua", vulcao: "Vulcão de Kragor", fabrica: "Fábrica de Bronze" });
const DOMAIN_LEVEL = Object.freeze({ floresta: 5, fabrica: 17, vulcao: 21 });

const P = (id, name, slot, set, domain, keys) =>
  G(id, "armor", name, "rare", {
    slot, set, domain, keys: Object.freeze(keys), level: DOMAIN_LEVEL[domain], sell: 0,
    source: Object.freeze([`Conjunto ${SETS.find((s) => s.id === set).name}: setores 7 a 10 do Domínio ${DOMAIN_NAME[domain]}.`]),
  });

const ITEMS = Object.freeze([
  P("vigilia_elmo", "Elmo da Vigília", "helm", "vigilia", "floresta", ["def", "hp"]),
  P("vigilia_peitoral", "Peitoral da Vigília", "chest", "vigilia", "floresta", ["def", "hp"]),
  P("vigilia_luvas", "Luvas da Vigília", "gloves", "vigilia", "floresta", ["def", "dex"]),
  P("vigilia_botas", "Botas da Vigília", "boots", "vigilia", "floresta", ["def", "dex"]),
  P("forja_elmo", "Elmo da Forja", "helm", "forja", "vulcao", ["acc", "warn"]),
  P("forja_peitoral", "Peitoral da Forja", "chest", "forja", "vulcao", ["stam", "def"]),
  P("forja_luvas", "Luvas da Forja", "gloves", "forja", "vulcao", ["dmg", "acc"]),
  P("forja_botas", "Botas da Forja", "boots", "forja", "vulcao", ["dex", "stam"]),
  P("sentinela_elmo", "Elmo da Sentinela de Bronze", "helm", "sentinela", "fabrica", ["def", "hp"]),
  P("sentinela_peitoral", "Peitoral da Sentinela de Bronze", "chest", "sentinela", "fabrica", ["def", "stam"]),
  P("sentinela_luvas", "Luvas da Sentinela de Bronze", "gloves", "sentinela", "fabrica", ["def", "dex"]),
  P("sentinela_botas", "Botas da Sentinela de Bronze", "boots", "sentinela", "fabrica", ["def", "stam"]),
]);

const DESCRIPTIONS = Object.freeze(Object.fromEntries(ITEMS.map((it) => {
  const s = SETS.find((x) => x.id === it.set);
  return [it.id, `Peça do conjunto ${s.name}. Com 2 peças o conjunto já soma; com as 4, soma inteiro.`];
})));

module.exports = { SETS, SET_STEPS, ITEMS, DESCRIPTIONS };
