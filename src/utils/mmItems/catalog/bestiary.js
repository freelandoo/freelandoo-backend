// src/utils/mmItems/catalog/bestiary.js — S14 (2026-11-12): FRAGMENTOS DO BESTIÁRIO.
//
// Proposta aprovada pelo Alex ("Aprovo, grava"): `MEU MUNDO 3D/planos/2026-11-12-bestiario-chefoes-proposta.md`
// §4 — o saque dos Domínios é sempre fragmento, nunca item inteiro. Responde a decisão A1 da trilha E
// (fragmento de personagem liberado). Três famílias novas:
//
// • De ACESSÓRIO (épico, 40 para fabricar) → o amuleto épico do Domínio (slot `amulet`, 2 chaves).
//   Cai no chefe da cena 1 (setor 3, ×1) e no elite do setor 7 (×1–2), garantido na vitória.
// • De PERSONAGEM (100 para completar) → o embrião do personagem. Guardião do setor 9: 1 por vitória;
//   elite que é personagem jogável (Ciborgue no Gelo 7–8, Dama das Garras na Fábrica 7–8, Golem no
//   Vulcão 7–8, Cavaleiro na Orbital 7–8): 1 com 25% por vitória. O Brutamontes é o guardião do Vulcão.
// • Do DEUS (100 para completar) → o embrião do deus. 1 por vitória no setor 10, +5 na primeira.
//
// A tela chama o embrião de CÁPSULA (24/11/2026, pedido do Alex; o id `embriao_*` fica). É material empilhável: o USO dele na Criogenia é a fatia seguinte (a descrição diz isso).
// As tabelas `domain:<id>:<setor>` (catalog/loot.js) leem DOMAIN_ADDS daqui.
"use strict";

const { G } = require("./_base");
const { DOMAIN_NAME, DOMAIN_LEVEL, powderPerFragment } = require("./lines");

/** Fragmentos para completar (proposta §4). */
const NEED = Object.freeze({ accessory: 40, character: 100, god: 100 });
/** Chance do fragmento de personagem no elite jogável (setores 7–8). */
const ELITE_CHANCE = 0.25;
/** Fragmentos do deus: 1 por vitória + 5 na primeira. */
const GOD_FRAGMENTS = Object.freeze({ qty: 1, first: 5 });

// ── amuletos dos Domínios (2 chaves do slot amulet: int, stam, hp, spd, power, dmg) ──
const AMULETS = Object.freeze([
  { domain: "floresta", name: "Amuleto da Floresta da Lua", keys: ["power", "hp"] },
  { domain: "canion", name: "Amuleto do Cânion das Tempestades", keys: ["spd", "dmg"] },
  { domain: "gelo", name: "Amuleto do Mar de Gelo", keys: ["hp", "stam"] },
  { domain: "fabrica", name: "Amuleto da Fábrica de Bronze", keys: ["int", "power"] },
  { domain: "vulcao", name: "Amuleto do Vulcão de Kragor", keys: ["dmg", "hp"] },
  { domain: "orbital", name: "Amuleto da Cidade Orbital", keys: ["spd", "power"] },
  { domain: "vermelha", name: "Amuleto da Floresta Vermelha", keys: ["dmg", "power"] },
]);
const AMULET_COINS = 900;

// ── personagens (guardião do setor 9 e elite jogável dos setores 7–8) ──
// id = o do monstro em meuMundoDomains.FOES_BY_DOMAIN
const CHARACTERS = Object.freeze([
  { id: "selene", name: "Selene de Sombra", domain: "floresta", sectors: [9], guardian: true },
  { id: "carta", name: "A Carta", domain: "canion", sectors: [9], guardian: true },
  { id: "ondina", name: "Ondina", domain: "gelo", sectors: [9], guardian: true },
  { id: "esteira", name: "A Esteira", domain: "fabrica", sectors: [9], guardian: true },
  { id: "brutamontes", name: "Brutamontes", domain: "vulcao", sectors: [9], guardian: true },
  { id: "arco", name: "O Arco Partido", domain: "orbital", sectors: [9], guardian: true },
  { id: "portaestandarte", name: "O Porta-Estandarte", domain: "vermelha", sectors: [9], guardian: true },
  { id: "ciborgue", name: "Ciborgue", domain: "gelo", sectors: [7, 8], guardian: false },
  { id: "garras", name: "Dama das Garras", domain: "fabrica", sectors: [7, 8], guardian: false },
  { id: "golem", name: "Golem de Pedra", domain: "vulcao", sectors: [7, 8], guardian: false },
  { id: "cavaleiro", name: "Cavaleiro Dourado", domain: "orbital", sectors: [7, 8], guardian: false },
]);
// ── deuses (setor 10) ──
const GODS = Object.freeze([
  { id: "noctis", name: "Noctis", domain: "floresta" },
  { id: "zephyra", name: "Zéphyra", domain: "canion" },
  { id: "maru", name: "Marú", domain: "gelo" },
  { id: "aeryn", name: "Aeryn", domain: "fabrica" },
  { id: "kragor", name: "Kragor", domain: "vulcao" },
  { id: "iris", name: "Íris", domain: "orbital" },
  { id: "varkos", name: "Varkos", domain: "vermelha" },
]);

// gacha-v1 (24/11/2026): a Cápsula dos 12 jogáveis vira personagem no Laboratório (POST /characters/capsule)
const PLAYABLE_CAPSULE = new Set(["ciborgue", "cavaleiro", "golem", "garras", "brutamontes", "noctis", "zephyra", "maru", "aeryn", "kragor", "iris", "varkos"]);
const CRIO_USE = "Use no Laboratório de Criogenia: o personagem nasce congelado numa vaga da cápsula (precisa de uma vaga livre).";
const CRIO_SOON = "Esse personagem ainda não é jogável: a Cápsula fica guardada na mochila até ele chegar.";
const crioText = (id) => (PLAYABLE_CAPSULE.has(id) ? CRIO_USE : CRIO_SOON);

const AMULET_ITEMS = AMULETS.map((a) => G(`amuleto_${a.domain}`, "accessory", a.name, "epic", {
  keys: Object.freeze(a.keys), domain: a.domain, level: DOMAIN_LEVEL[a.domain], sell: 0, bestiary: true,
}));
const AMULET_FRAGMENTS = AMULETS.map((a) => G(`frag_amuleto_${a.domain}`, "fragment", `Fragmento: ${a.name}`, "epic", {
  stack: true, domain: a.domain, sell: 0,
  fragment: Object.freeze({ of: `amuleto_${a.domain}`, need: NEED.accessory, powder: powderPerFragment(4) }),
  origin: Object.freeze({ region: a.domain, boss: null, table: `domain:${a.domain}:3,7`, kind: "sector" }),
}));
const CHARACTER_EMBRYOS = CHARACTERS.map((c) => G(`embriao_${c.id}`, "material", `Cápsula: ${c.name}`, "epic", { stack: true, domain: c.domain, sell: 0, embryo: Object.freeze({ of: c.id, kind: "character" }) }));
const CHARACTER_FRAGMENTS = CHARACTERS.map((c) => G(`frag_personagem_${c.id}`, "fragment", `Fragmento de personagem: ${c.name}`, "epic", {
  stack: true, domain: c.domain, sell: 0,
  fragment: Object.freeze({ of: `embriao_${c.id}`, need: NEED.character, powder: powderPerFragment(4) }),
  origin: Object.freeze({ region: c.domain, boss: null, table: `domain:${c.domain}:${c.sectors.join(",")}`, kind: c.guardian ? "guardian" : "elite" }),
}));
const GOD_EMBRYOS = GODS.map((g) => G(`embriao_${g.id}`, "material", `Cápsula: ${g.name}`, "legendary", { stack: true, domain: g.domain, sell: 0, embryo: Object.freeze({ of: g.id, kind: "god" }) }));
const GOD_FRAGMENTS_ITEMS = GODS.map((g) => G(`frag_deus_${g.id}`, "fragment", `Fragmento do deus: ${g.name}`, "legendary", {
  stack: true, domain: g.domain, sell: 0,
  fragment: Object.freeze({ of: `embriao_${g.id}`, need: NEED.god, powder: powderPerFragment(5) }),
  origin: Object.freeze({ region: g.domain, boss: g.id, table: `domain:${g.domain}:10`, kind: "boss" }),
}));

const RECIPES = Object.freeze([
  ...AMULETS.map((a) => Object.freeze({
    id: `fabricar_amuleto_${a.domain}`, kind: "fragment", out: `amuleto_${a.domain}`, qty: 1,
    // 24/11/2026 (tudo por fragmento): só os 40 fragmentos, sem material do Domínio
    needs: Object.freeze({ [`frag_amuleto_${a.domain}`]: NEED.accessory }),
    coins: AMULET_COINS, level: DOMAIN_LEVEL[a.domain],
  })),
  ...CHARACTERS.map((c) => Object.freeze({
    id: `fabricar_embriao_${c.id}`, kind: "fragment", out: `embriao_${c.id}`, qty: 1,
    needs: Object.freeze({ [`frag_personagem_${c.id}`]: NEED.character }), coins: 0, level: DOMAIN_LEVEL[c.domain],
  })),
  ...GODS.map((g) => Object.freeze({
    id: `fabricar_embriao_${g.id}`, kind: "fragment", out: `embriao_${g.id}`, qty: 1,
    needs: Object.freeze({ [`frag_deus_${g.id}`]: NEED.god }), coins: 0, level: DOMAIN_LEVEL[g.domain],
  })),
]);

/**
 * O que cada setor ganha a mais (E12 + S14), lido por domainTable em catalog/loot.js. `sure` entra no
 * fim do garantido; `chance` no fim do sorteio; `first` no fim da primeira vitória (a ordem de antes
 * não muda).
 */
function domainAdds(domain, sector) {
  const sure = [], chance = [], first = [];
  const one = Object.freeze([1, 1]);
  if (sector === 3) sure.push({ id: `frag_amuleto_${domain}`, qty: one, win: true });
  if (sector === 7) sure.push({ id: `frag_amuleto_${domain}`, qty: Object.freeze([1, 2]), win: true });
  for (const c of CHARACTERS) {
    if (c.domain !== domain || !c.sectors.includes(sector)) continue;
    if (c.guardian) sure.push({ id: `frag_personagem_${c.id}`, qty: one, win: true });
    else chance.push({ id: `frag_personagem_${c.id}`, qty: one, p: ELITE_CHANCE, win: true });
  }
  const god = sector === 10 && GODS.find((g) => g.domain === domain);
  if (god) {
    sure.push({ id: `frag_deus_${god.id}`, qty: Object.freeze([GOD_FRAGMENTS.qty, GOD_FRAGMENTS.qty]), win: true });
    first.push({ id: `frag_deus_${god.id}`, qty: Object.freeze([GOD_FRAGMENTS.first, GOD_FRAGMENTS.first]) });
  }
  return { sure, chance, first };
}

const DESCRIPTIONS = Object.freeze({
  ...Object.fromEntries(AMULETS.map((a) => [`amuleto_${a.domain}`, `Amuleto épico do Domínio ${DOMAIN_NAME[a.domain]}. Fabricado na Forja com ${NEED.accessory} fragmentos.`])),
  ...Object.fromEntries(AMULETS.map((a) => [`frag_amuleto_${a.domain}`, `Junte ${NEED.accessory} para fabricar o ${a.name} na Forja. Cai no chefe da primeira cena (setor 3), no elite do setor 7 e, com sorte, no lugar do material raro do Domínio. O que sobrar vira Pó de Refino.`])),
  ...Object.fromEntries(CHARACTERS.map((c) => [`frag_personagem_${c.id}`, `Junte ${NEED.character} para completar a Cápsula de ${c.name}. ${c.guardian ? "O guardião do setor 9 deixa 1 a cada vitória." : "Cai com 25% a cada vitória contra o elite dos setores 7 e 8."}`])),
  ...Object.fromEntries(CHARACTERS.map((c) => [`embriao_${c.id}`, `Cápsula de ${c.name}, completada com ${NEED.character} fragmentos. ${crioText(c.id)}`])),
  ...Object.fromEntries(GODS.map((g) => [`frag_deus_${g.id}`, `Junte ${NEED.god} para completar a Cápsula de ${g.name}. O deus deixa 1 a cada vitória e mais ${GOD_FRAGMENTS.first} na primeira.`])),
  ...Object.fromEntries(GODS.map((g) => [`embriao_${g.id}`, `Cápsula de ${g.name}, completada com ${NEED.god} fragmentos. ${crioText(g.id)}`])),
});

const FRAGMENTS = Object.freeze([...AMULET_FRAGMENTS, ...CHARACTER_FRAGMENTS, ...GOD_FRAGMENTS_ITEMS]);

module.exports = {
  NEED, ELITE_CHANCE, GOD_FRAGMENTS, AMULETS, CHARACTERS, GODS, RECIPES, DESCRIPTIONS, FRAGMENTS, domainAdds,
  ITEMS: Object.freeze([...AMULET_ITEMS, ...FRAGMENTS, ...CHARACTER_EMBRYOS, ...GOD_EMBRYOS]),
};
