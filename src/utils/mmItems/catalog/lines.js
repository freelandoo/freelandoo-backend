// src/utils/mmItems/catalog/lines.js — trilha E, fatia E8: ARMAS DE LINHA, FRAGMENTOS, MATERIAIS
// NOVOS, FICHAS E RECEITAS POR FRAGMENTO (GDD `MEU MUNDO 3D/gdd/economia-e-equipamentos.md`, H/I/J).
//
// • 9 armas de linha (uma por deus, formas da A11), lendárias, que se fabricam com 60 fragmentos + os
//   materiais do Domínio (ou da fonte da A9) + universais. Golpes vêm da skin, nunca da arma.
// • 12 fragmentos: um por arma (60 para fabricar) e um por conjunto (20 por peça).
// • 24 materiais (9 universais + 15 de Domínio/deus) e 2 fichas (Pó de Refino, Selo de Domínio).
// • 12 projetos (9 receitas de arma + 3 de conjunto) e as 21 receitas `kind: "fragment"`.
// As tabelas de saque que entregam estes itens chegam com a E12 (Domínios) e a E17 (atividades);
// até lá a origem é DECLARADA aqui (`source`) e o Índice de fragmentos lê `origin`.
"use strict";

const { G } = require("./_base");

const DOMAIN_NAME = Object.freeze({
  floresta: "Floresta da Lua", canion: "Cânion das Tempestades", gelo: "Mar de Gelo",
  fabrica: "Fábrica de Bronze", vulcao: "Vulcão de Kragor", orbital: "Cidade Orbital",
});
/** Nível de aventura da porta do Domínio (`meuMundoDomains.js`, `need`). */
const DOMAIN_LEVEL = Object.freeze({ floresta: 5, canion: 9, gelo: 13, fabrica: 17, vulcao: 21, orbital: 25 });

/** Regra do fragmento de chefão (§6.5): 3 a 5 por vitória + 10 na primeira. A E12 usa nas tabelas. */
const BOSS_FRAGMENTS = Object.freeze({ qty: Object.freeze([3, 5]), first: 10 });
/** Fragmento de conjunto nos setores 7 a 10: 2 a 3 por vitória. */
const SET_FRAGMENTS = Object.freeze({ qty: Object.freeze([2, 3]) });
/** Fragmentos para fabricar, por raridade (§6.5). */
const NEED = Object.freeze({ rare: 20, epic: 40, legendary: 60, mythic: 80 });
/** Excedente: 1 fragmento → 2 × tier de Pó de Refino (§6.5). */
const powderPerFragment = (tier) => 2 * tier;

// ── as 9 linhas (GDD H e J) ──
// region: onde a fonte principal mora (Domínio, Hall, rua de noite, Paint) · boss: quem paga o fragmento
const LINES = Object.freeze([
  { key: "primeira_chama", name: "Espada da Primeira Chama", god: "aurion", shop: "weapons", clan: "vampiro", keys: ["dmg", "power"], region: "hall", boss: "aurion", table: "fight:hall", level: 10, mats: { brasa_solar: 18 }, where: "Hall dos Campeões: vitória contra o campeão" },
  { key: "tridente_mares", name: "Tridente das Marés", god: "maru", shop: "hammers", keys: ["dmg", "power"], region: "gelo", boss: "maru", table: "domain:gelo:10", mats: { gelo_negro: 20, perola_de_afogado: 3 } },
  { key: "lamina_correntes", name: "Lâmina das Correntes", god: "morkhan", shop: "weapons", clan: "vampiro", keys: ["dmg", "power"], region: "rua", boss: "elite", table: "mob:elite", level: 10, mats: { cinza_das_correntes: 18 }, where: "Monstros de elite da rua, de noite" },
  { key: "martelo_incandescente", name: "Martelo Incandescente", god: "kragor", shop: "hammers", keys: ["dmg", "power"], region: "vulcao", boss: "kragor", table: "domain:vulcao:10", mats: { escoria: 20, ferro_de_basalto: 3 } },
  { key: "sabre_vendaval", name: "Sabre do Vendaval", god: "zephyra", shop: "weapons", clan: "vampiro", keys: ["dmg", "acc"], region: "canion", boss: "zephyra", table: "domain:canion:10", mats: { areia_de_raio: 20, pena_de_tempestade: 3 } },
  { key: "arco_prismatico", name: "Arco Prismático", god: "iris", shop: "bows", keys: ["dmg", "acc"], region: "orbital", boss: "iris", table: "domain:orbital:10", mats: { vidro_colorido: 20, prisma_vivo: 3 } },
  { key: "garras_lunares", name: "Garras Lunares", god: "noctis", shop: "guns", keys: ["dmg", "acc"], region: "floresta", boss: "noctis", table: "domain:floresta:10", mats: { po_de_lua: 20, seiva_de_prata: 3 } },
  { key: "arco_bronze_vivo", name: "Arco de Bronze Vivo", god: "aeryn", shop: "bows", keys: ["dmg", "acc"], region: "fabrica", boss: "aeryn", table: "domain:fabrica:10", mats: { engrenagem_fina: 20, coracao_de_corda: 3 } },
  { key: "cajado_moldes", name: "Cajado dos Moldes", god: "bastor", clan: "raposa", keys: ["dmg", "power"], region: "paint", boss: null, table: "minigame:paint", level: 5, mats: { barro_primordial: 18 }, where: "Paint: 2 a 3 por vitória" },
]);
const LINE_COINS = 2360;
const UNIVERSAL_LINE = Object.freeze({ lingote_refinado: 4, essencia_primordial: 1 });

const regionName = (r) => DOMAIN_NAME[r] || ({ hall: "Hall dos Campeões", rua: "Rua de noite", paint: "Paint" })[r] || r;
const bossLine = (l) => l.where || `Domínio ${DOMAIN_NAME[l.region]}: chefão do setor 10 (3 a 5 por vitória, 10 na primeira)`;

const LINE_WEAPONS = LINES.map((l) => G(`linha_${l.key}`, "weapon", l.name, "legendary", {
  shop: l.shop || undefined, clan: l.clan || null, keys: Object.freeze(l.keys), domain: l.god, line: true,
  level: l.level || DOMAIN_LEVEL[l.region], sell: 0,
}));

// ── fragmentos (GDD I) ──
const SETS = Object.freeze([
  { id: "vigilia", name: "Vigília", domain: "floresta", mats: { po_de_lua: 12, seiva_de_prata: 1, minerio_prata: 10 } },
  { id: "forja", name: "Forja", domain: "vulcao", mats: { escoria: 12, ferro_de_basalto: 1, minerio_ferro: 10 } },
  { id: "sentinela", name: "Sentinela de Bronze", domain: "fabrica", mats: { engrenagem_fina: 12, coracao_de_corda: 1, minerio_ferro: 10 } },
]);
const SET_PIECES = (id) => ["elmo", "peitoral", "luvas", "botas"].map((p) => `${id}_${p}`);
const SET_COINS = 460;

const LINE_FRAGMENTS = LINES.map((l) => G(`frag_${l.key}`, "fragment", `Fragmento: ${l.name}`, "legendary", {
  stack: true, domain: l.god, sell: 0,
  fragment: Object.freeze({ of: `linha_${l.key}`, need: NEED.legendary, powder: powderPerFragment(5) }),
  origin: Object.freeze({ region: l.region, boss: l.boss, table: l.table, kind: l.boss ? "boss" : "activity" }),
  source: Object.freeze([`${bossLine(l)}.`]),
}));
const SET_FRAGMENT_ITEMS = SETS.map((s) => G(`frag_${s.id}`, "fragment", `Fragmento do conjunto ${s.name}`, "rare", {
  stack: true, domain: s.domain, set: s.id, sell: 0,
  fragment: Object.freeze({ of: SET_PIECES(s.id)[0], set: s.id, need: NEED.rare, powder: powderPerFragment(3) }),
  origin: Object.freeze({ region: s.domain, boss: null, table: `domain:${s.domain}:7-10`, kind: "sector" }),
  source: Object.freeze([`Domínio ${DOMAIN_NAME[s.domain]}: setores 7 a 10 (2 a 3 por vitória).`]),
}));

// ── materiais e fichas (GDD I) ──
const NOTES = Object.freeze({
  pedra_aprimoramento: "Custo de cada passo do aprimoramento garantido (+1 a +15).",
  catalisador_refino: "Custo do refinamento dos graus II a V.",
  madeira_ancestral: "Reservado às runas e aos preparos, que chegam depois.",
  cristal_bruto: "Reservado às runas e aos preparos, que chegam depois.",
  po_forja: "Reservado às runas e aos preparos, que chegam depois.",
  po_refino: "Custo do refinamento dos graus II a V.",
  selo_dominio: "Custo da Ascensão, que libera o +11 ao +15.",
});
const notes = (id) => (NOTES[id] ? { notes: Object.freeze([NOTES[id]]) } : {});
const M = (id, name, rarity, domain, where) => G(id, "material", name, rarity, { domain, sell: 0, source: Object.freeze([where]), ...notes(id) });
const DOM_COMMON = (d) => `Domínio ${DOMAIN_NAME[d]}: garantido em todo setor (1 a 4 por vitória).`;
const DOM_RARE = (d) => `Domínio ${DOMAIN_NAME[d]}: chance nos setores 1 a 9 (5% + 3% por setor) e garantido no setor 10.`;
const MATERIALS = Object.freeze([
  M("minerio_ferro", "Minério de Ferro", "common", null, "Minijogos e monstros da rua: 1 a 2 por partida validada."),
  M("minerio_prata", "Minério de Prata", "uncommon", null, "Boxe e Domínios: garantido no Boxe, chance de 20% nos setores."),
  M("lingote_refinado", "Lingote Refinado", "rare", null, "Lâminas (15%) e Domínios a partir do setor 4 (25%)."),
  M("madeira_ancestral", "Madeira Ancestral", "uncommon", null, "Antigravidade e Gincana: chance de 25% por partida."),
  M("cristal_bruto", "Cristal Bruto", "uncommon", null, "Jetpack, Rolê Noturno e Domínios: chance de 15% a 25%."),
  M("po_forja", "Pó de Forja", "common", null, "Lâminas (garantido), minijogos e monstros da rua (30%)."),
  M("pedra_aprimoramento", "Pedra de Aprimoramento", "uncommon", null, "Vitórias na Arena das Lâminas, no Boxe, na rua e nos Domínios: chance de 50%."),
  M("catalisador_refino", "Catalisador de Refino", "epic", null, "Hall dos Campeões (20%) e Domínios a partir do setor 8 (10%)."),
  M("essencia_primordial", "Essência Primordial", "legendary", null, "Hall dos Campeões (10%) e chefões dos Domínios (25%)."),
  M("po_de_lua", "Pó de Lua", "common", "floresta", DOM_COMMON("floresta")),
  M("seiva_de_prata", "Seiva de Prata", "rare", "floresta", DOM_RARE("floresta")),
  M("areia_de_raio", "Areia de Raio", "common", "canion", DOM_COMMON("canion")),
  M("pena_de_tempestade", "Pena de Tempestade", "rare", "canion", DOM_RARE("canion")),
  M("gelo_negro", "Gelo Negro", "common", "gelo", DOM_COMMON("gelo")),
  M("perola_de_afogado", "Pérola de Afogado", "rare", "gelo", DOM_RARE("gelo")),
  M("engrenagem_fina", "Engrenagem Fina", "common", "fabrica", DOM_COMMON("fabrica")),
  M("coracao_de_corda", "Coração de Corda", "rare", "fabrica", DOM_RARE("fabrica")),
  M("escoria", "Escória", "common", "vulcao", DOM_COMMON("vulcao")),
  M("ferro_de_basalto", "Ferro de Basalto", "rare", "vulcao", DOM_RARE("vulcao")),
  M("vidro_colorido", "Vidro Colorido", "common", "orbital", DOM_COMMON("orbital")),
  M("prisma_vivo", "Prisma Vivo", "rare", "orbital", DOM_RARE("orbital")),
  M("brasa_solar", "Brasa Solar", "uncommon", "aurion", "Hall dos Campeões (1 a 2 por vitória) e Lâminas (35%)."),
  M("cinza_das_correntes", "Cinza das Correntes", "uncommon", "morkhan", "Monstros da rua de noite (35%); de elite, 1 a 2 garantidos."),
  M("barro_primordial", "Barro Primordial", "uncommon", "bastor", "Paint: 1 a 2 por vitória."),
]);
const CURRENCY = Object.freeze([
  G("po_refino", "currency", "Pó de Refino", "uncommon", { stack: true, sell: 0, ...notes("po_refino"), source: Object.freeze(["Forja: converter fragmentos que sobram (2 × tier cada) e desmontar equipamento."]) }),
  G("selo_dominio", "currency", "Selo de Domínio", "rare", { stack: true, sell: 0, ...notes("selo_dominio"), source: Object.freeze(["Chefão do setor 10 de qualquer Domínio: 1 por vitória."]) }),
]);

// ── projetos (GDD I) ──
const BLUEPRINTS = Object.freeze([
  ...LINES.map((l) => G(`receita_${l.key}`, "recipe", `Receita: ${l.name}`, "legendary", {
    sell: 0, domain: l.god, source: Object.freeze([`${l.where || `Domínio ${DOMAIN_NAME[l.region]}: chefão do setor 10`}, na primeira vitória.`]),
  })),
  ...SETS.map((s) => G(`projeto_${s.id}`, "recipe", `Projeto: conjunto ${s.name}`, "rare", {
    sell: 0, domain: s.domain, set: s.id, source: Object.freeze([`Domínio ${DOMAIN_NAME[s.domain]}: primeira vitória no setor 7.`]),
  })),
]);

// ── receitas por fragmento (GDD J) ──
const FRAGMENT_RECIPES = Object.freeze([
  ...LINES.map((l) => Object.freeze({
    id: `fabricar_${l.key}`, kind: "fragment", out: `linha_${l.key}`, qty: 1,
    needs: Object.freeze({ [`frag_${l.key}`]: NEED.legendary, ...l.mats, ...UNIVERSAL_LINE }),
    coins: LINE_COINS, level: l.level || DOMAIN_LEVEL[l.region], recipe: `receita_${l.key}`,
  })),
  ...SETS.flatMap((s) => SET_PIECES(s.id).map((piece) => Object.freeze({
    id: `fabricar_${piece}`, kind: "fragment", out: piece, qty: 1,
    needs: Object.freeze({ [`frag_${s.id}`]: NEED.rare, ...s.mats }),
    coins: SET_COINS, level: DOMAIN_LEVEL[s.domain], recipe: `projeto_${s.id}`,
  }))),
]);

const DESCRIPTIONS = Object.freeze({
  ...Object.fromEntries(LINES.map((l) => [`linha_${l.key}`, `Arma de linha ligada a ${l.god === "bastor" ? "Bastor, o deus dos moldes" : "um dos deuses"}. Fabricada com ${NEED.legendary} fragmentos; muda o modelo, o rastro e o bônus, nunca os golpes.`])),
  ...Object.fromEntries(LINES.map((l) => [`frag_${l.key}`, `Junte ${NEED.legendary} para fabricar ${l.name} na Forja. O que sobrar vira Pó de Refino.`])),
  ...Object.fromEntries(SETS.map((s) => [`frag_${s.id}`, `Cada peça do conjunto ${s.name} pede ${NEED.rare}. O que sobrar vira Pó de Refino.`])),
  ...Object.fromEntries(SETS.map((s) => [`projeto_${s.id}`, `Projeto que, aprendido, habilita fabricar as 4 peças do conjunto ${s.name} com fragmentos.`])),
  ...Object.fromEntries(LINES.map((l) => [`receita_${l.key}`, `Receita que, aprendida, habilita fabricar ${l.name} com fragmentos.`])),
  minerio_ferro: "Minério comum de Lúmen. Base dos conjuntos da Forja e da Sentinela de Bronze.",
  minerio_prata: "Minério claro, mais raro. Base do conjunto Vigília.",
  lingote_refinado: "Metal já fundido e limpo. Toda arma de linha pede quatro.",
  madeira_ancestral: "Madeira antiga e dura. Reservada às runas e aos preparos.",
  cristal_bruto: "Cristal ainda sem lapidar. Reservado às runas e aos preparos.",
  po_forja: "Resto fino da forja. Reservado às runas e aos preparos.",
  essencia_primordial: "O que sobra de um deus vencido. Toda arma de linha pede uma.",
  po_de_lua: "Poeira prateada da Floresta da Lua.",
  seiva_de_prata: "Seiva que só escorre das árvores mais velhas da Floresta da Lua.",
  areia_de_raio: "Areia vitrificada pelos raios do Cânion das Tempestades.",
  pena_de_tempestade: "Pena carregada de eletricidade, achada no alto do Cânion.",
  gelo_negro: "Gelo escuro que não derrete, do fundo do Mar de Gelo.",
  perola_de_afogado: "Pérola fria tirada dos afogados do Mar de Gelo.",
  engrenagem_fina: "Engrenagem miúda das linhas da Fábrica de Bronze.",
  coracao_de_corda: "O mecanismo que fazia uma das máquinas da Fábrica andar sozinha.",
  escoria: "Resto da fundição do Vulcão de Kragor.",
  ferro_de_basalto: "Ferro preso no basalto do Vulcão; só sai quebrando a pedra.",
  vidro_colorido: "Caco de vitral da Cidade Orbital.",
  prisma_vivo: "Prisma que ainda divide a luz sozinho, da Cidade Orbital.",
  brasa_solar: "Brasa que não apaga, guardada pelos campeões de Aurion.",
  cinza_das_correntes: "Cinza deixada pelas correntes de Morkhan nos monstros da rua.",
  barro_primordial: "O barro com que Bastor molda as coisas. Sai das partidas de Paint.",
  po_refino: "Ficha da bancada de refinamento: paga os graus II a V das peças.",
  selo_dominio: "Prova de que um chefão de Domínio caiu. Paga a Ascensão das peças.",
  pedra_aprimoramento: "Paga cada passo do aprimoramento garantido, junto com as Esmeraldas.",
  catalisador_refino: "Estabiliza o refinamento dos graus II a V.",
});

module.exports = {
  DOMAIN_NAME, DOMAIN_LEVEL, BOSS_FRAGMENTS, SET_FRAGMENTS, NEED, powderPerFragment, LINES, regionName,
  LINE_WEAPONS, FRAGMENTS: Object.freeze([...LINE_FRAGMENTS, ...SET_FRAGMENT_ITEMS]), MATERIALS, CURRENCY, BLUEPRINTS,
  FRAGMENT_RECIPES, DESCRIPTIONS,
  ITEMS: Object.freeze([...LINE_WEAPONS, ...LINE_FRAGMENTS, ...SET_FRAGMENT_ITEMS, ...MATERIALS, ...CURRENCY, ...BLUEPRINTS]),
};
