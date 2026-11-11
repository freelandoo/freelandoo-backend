#!/usr/bin/env node
// scripts/mm-balance.js — trilha E, fatia E0: as contas de equidade do Meu Mundo com a regra REAL.
//
//   node scripts/mm-balance.js          as 7 seções (A…G) do §6 do plano, em texto
//   node scripts/mm-balance.js --md     as tabelas do GDD (MEU MUNDO 3D/gdd/economia-e-equipamentos.md)
//   node scripts/mm-balance.js --json   tudo, em JSON (o teste meuMundoEquidade.test.js usa as funções)
//   node scripts/mm-balance.js --loot   E3: cada tabela de saque EM USO — esperado e pior caso por vitória,
//                                       por derrota e por minuto ativo (o nível não muda nada)
//
// Lê src/utils/meuMundoFight.js (cópia gerada da luta), meuMundoAdventure.js, meuMundoGear.js e a régua
// src/utils/mmItems/rules/budget.js. Não muda nenhuma regra: só mede. A proposta de itens novos (§7)
// mora aqui até a E1/E8 levarem para mmItems/catalog/*.
"use strict";

const F = require("../src/utils/meuMundoFight");
const A = require("../src/utils/meuMundoAdventure");
const Gear = require("../src/utils/meuMundoGear");
const B = require("../src/utils/mmItems/rules/budget");

const r = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const LEVELS = [1, 5, 10, 20, 30, 60, 100, 200, 500];
const I1_LEVELS = [10, 30, 60, 100, 200, 500];

// ── luta ─────────────────────────────────────────────────────────────────────

/** O que o nível soma em ataque e defesa do herói (0 no 1, 900 no 60, e segue). */
const levelRate = (L) => (900 * (L - 1)) / 59;
/** Régua do nível: o `rate` de um monstro daquele nível (100 + 18,52 por nível). */
const ruler = (L) => F.mobBase(L).rate;
const meanCombo = F.COMBO.reduce((a, c) => a + c.dmg, 0) / F.COMBO.length;
const rankAvg = (i, d) => F.rankOdds(i, d).reduce((a, p, k) => a + p * F.RANK.dmg[k], 0);
/** Abaixo de 50% de acerto ninguém acerta dois seguidos (regra da luta). */
const eff = (p) => (p < 0.5 ? p / (1 + p) : p);

const NO = Object.freeze({ dmg: 0, def: 0, stam: 0, warn: 0, power: 0 });
const CAP_TODAY = Object.freeze({ ...Gear.GEAR_CAP });
const st = (v) => ({ strength: v, speed: v, intelligence: v, dexterity: v });

/**
 * Troca de golpes herói × monstro (índice relativo; não é chance de vitória).
 * `mult` aplica o modelo proporcional da A12 por cima da ficha SEM equipamento (só para medir a proposta).
 */
function duel(body, L, stats, gear, kind, M, mult = null) {
  const sh = { ...F.heroSheet(body, L, stats, gear) };
  if (mult) {
    sh.atk *= 1 + (mult.dmg || 0);
    sh.def *= 1 + (mult.def || 0);
    sh.hp *= 1 + (mult.hp || 0);
    sh.acc *= 1 + (mult.acc || 0);
    sh.spd *= 1 + (mult.spd || 0);
  }
  const base = F.mobBase(M);
  const ms = F.MOB_SHEETS[kind];
  const mob = { hp: (base.hp * ms[0]) / 100, atk: (base.rate * ms[1]) / 100, def: (base.rate * ms[2]) / 100, acc: (base.rate * ms[3]) / 100, spd: (base.rate * ms[4]) / 100 };
  const hs = F.heroStats(stats, L);
  const heroHit = meanCombo * (F.heroLevelScale(L).hp / 100) * rankAvg(hs.intelligence, hs.dexterity) * F.damageRatio(sh.atk, mob.def);
  const mobHit = meanCombo * (base.hp / 100) * F.damageRatio(mob.atk, sh.def);
  const pHero = F.hitChance(sh.acc, mob.spd);
  const pMob = F.hitChance(mob.acc, sh.spd);
  const swings = mob.hp / (heroHit * eff(pHero));
  const attacks = sh.hp / (mobHit * eff(pMob));
  return { pHero, pMob, swings, attacks, ratio: attacks / swings };
}

/** I1 — luta igual na Arena: atributo na paridade com a velocidade do monstro. */
function evenFight(kind, L) {
  const ms = F.MOB_SHEETS[kind];
  const need = Math.max(0, (ruler(L) * ms[4]) / 100 - 100 - 3 * (L - 1));
  return duel(null, L, st(need), NO, kind, L);
}

function sectionA() {
  return LEVELS.map((L) => {
    const base = 100 + levelRate(L);
    return { L, hp: F.heroLevelScale(L).hp, atkDef: r(base, 0), flat150: r((150 / base) * 100, 1), xp: A.xpToNext(L), wins: r(A.xpToNext(L) / A.fightXp("cavaleiro", L, true), 0) };
  });
}

function sectionB() {
  const out = {};
  for (const kind of Object.keys(F.MOB_SHEETS)) {
    const rows = I1_LEVELS.map((L) => {
      const d = evenFight(kind, L);
      return { L, swings: r(d.swings, 1), attacks: r(d.attacks, 1) };
    });
    const sw = I1_LEVELS.map((L) => evenFight(kind, L).swings); // sem arredondar, igual ao teste
    const mean = sw.reduce((a, b) => a + b, 0) / sw.length;
    // variação = (maior − menor) ÷ média: o "no máximo 10%" da I1
    out[kind] = { rows, spread: r((Math.max(...sw) - Math.min(...sw)) / mean, 3), spreadMin: r((Math.max(...sw) - Math.min(...sw)) / Math.min(...sw), 3) };
  }
  return out;
}

const PROP_CAP = Object.freeze({ dmg: B.CAP.dmg, def: B.CAP.def, hp: B.CAP.hp });
function sectionC() {
  return LEVELS.map((L) => {
    const a = duel(null, L, st(300), NO, "brute", L);
    const b = duel(null, L, st(300), CAP_TODAY, "brute", L);
    const p = duel(null, L, st(300), NO, "brute", L, { dmg: PROP_CAP.dmg, def: PROP_CAP.def });
    const q = duel(null, L, st(300), NO, "brute", L, PROP_CAP);
    return { L, today: r(b.ratio / a.ratio, 2), prop: r(p.ratio / a.ratio, 2), propHp: r(q.ratio / a.ratio, 2), flatLevels: r(150 / 15.25, 1), propLevels: r((B.CAP.dmg * (100 + levelRate(L))) / 15.25, 1) };
  });
}

/** A14: freio do drop pela régua (proposta; a regra em uso NÃO tem freio). */
/** E5: a regra em uso (meuMundoAdventure.dropPace), não uma cópia. */
const dropPace = (attr, L) => A.dropPace(attr, L);

/** I5 — atributo pelo drop da luta (adulto, 15 por vitória, 45% acuracidade, 15% velocidade), com e sem o freio. */
function sectionD(maxL = 500) {
  const marks = new Set([10, 20, 30, 60, 100, 200, 500].filter((L) => L <= maxL));
  const brute = F.MOB_SHEETS.brute;
  const cib = F.MOB_SHEETS.ciborgue;
  const out = [];
  let wins = 0;
  let acc = 25;
  let spd = 25;
  let accP = 25;
  let spdP = 25;
  let carry = 0;
  for (let L = 1; L <= maxL; L++) {
    if (marks.has(L)) {
      const R = ruler(L);
      const hit = (ms, s) => Math.min(1, ((R * ms[3]) / 100) / (100 + s + 3 * (L - 1)));
      out.push({
        L, wins: Math.round(wins), acc: Math.round(acc), accX: r(acc / R, 2), spd: Math.round(spd), spdX: r(spd / R, 2), bruteHit: r(hit(brute, spd) * 100, 0),
        accP: Math.round(accP), accPX: r(accP / R, 2), spdP: Math.round(spdP), spdPX: r(spdP / R, 2), bruteHitP: r(hit(brute, spdP) * 100, 0), cibHitP: r(hit(cib, spdP) * 100, 0),
      });
    }
    const n = A.xpToNext(L) / A.fightXp("cavaleiro", L, true);
    wins += n;
    acc += n * 6.75;
    spd += n * 2.25;
    carry += n;
    const whole = Math.floor(carry);
    carry -= whole;
    for (let i = 0; i < whole; i++) {
      accP += 6.75 * dropPace(accP, L);
      spdP += 2.25 * dropPace(spdP, L);
    }
  }
  return out;
}

/** A15 (proposta): fator sobre a régua e chances; o sorteio em uso é +3…+20 níveis. */
const STREET_FACTORS = Object.freeze([{ f: 1, p: 0.2 }, { f: 1.1, p: 0.3 }, { f: 1.25, p: 0.2 }, { f: 1.4, p: 0.2 }, { f: 1.6, p: 0.1 }]);
/** E5: a regra em uso (meuMundoAdventure.levelForFactor). */
const levelForFactor = (L, f) => A.levelForFactor(L, f);
function sectionE() {
  const today = [1, 5, 10, 30, 60, 100, 200].map((L) => ({ L, over: Object.fromEntries([3, 10, 12, 20].map((k) => [k, r((ruler(L + k) / ruler(L) - 1) * 100, 0)])) }));
  const proposal = [1, 5, 10, 30, 60, 100, 200].map((L) => ({ L, plus: Object.fromEntries(STREET_FACTORS.filter((x) => x.f > 1).map((x) => [x.f, levelForFactor(L, x.f) - L])) }));
  return { today, proposal };
}

function sectionF() {
  const rows = B.KEYS.map((k) => {
    const b = B.focusedBuild(k);
    return { k, pieces: r(b.pieces, 4), total: r(b.total, 4), cap: B.CAP[k] };
  });
  const sample = {
    common0: r(B.piece("dmg", "weapon", "common", 0, 1), 4),
    rare0: r(B.piece("dmg", "weapon", "rare", 0, 1), 4),
    legendary10: r(B.piece("dmg", "weapon", "legendary", 10, 1), 4),
    mythic15V: r(B.piece("dmg", "weapon", "mythic", 15, 5), 4),
  };
  return { rows, sample };
}

function sectionG() {
  const tiers = Object.entries(B.REF).map(([tier, L]) => ({ tier: +tier, L, perWin: r(B.income(L), 0), steps: B.WINS.map((_, i) => B.upgradeEmeralds(+tier, i + 1)) }));
  const winsTotal = B.WINS.reduce((a, b) => a + b, 0);
  const stones = B.STONES.reduce((a, b) => a + b, 0);
  /** Nível em que a moeda passa a custar menos vitórias que o material (cruzamento da I8). */
  const crossing = (tier) => {
    let L = 1;
    while ((winsTotal * B.income(B.REF[tier])) / B.income(L) > stones / B.STONE_PER_WIN) L++;
    return L;
  };
  return { tiers, winsTotal, stones, stoneWins: stones / B.STONE_PER_WIN, t6at200: r((winsTotal * B.income(40)) / B.income(200), 0), crossing: Object.fromEntries(Object.keys(B.REF).map((t) => [t, crossing(+t)])) };
}

// ── proposta de itens da versão jogável (§7) ────────────────────────────────

const DOMAINS = Object.freeze([
  { id: "floresta", god: "noctis", name: "Floresta da Lua", common: ["po_de_lua", "Pó de Lua"], rare: ["seiva_de_prata", "Seiva de Prata"] },
  { id: "canion", god: "zephyra", name: "Cânion das Tempestades", common: ["areia_de_raio", "Areia de Raio"], rare: ["pena_de_tempestade", "Pena de Tempestade"] },
  { id: "gelo", god: "maru", name: "Mar de Gelo", common: ["gelo_negro", "Gelo Negro"], rare: ["perola_de_afogado", "Pérola de Afogado"] },
  { id: "fabrica", god: "aeryn", name: "Fábrica de Bronze", common: ["engrenagem_fina", "Engrenagem Fina"], rare: ["coracao_de_corda", "Coração de Corda"] },
  { id: "vulcao", god: "kragor", name: "Vulcão de Kragor", common: ["escoria", "Escória"], rare: ["ferro_de_basalto", "Ferro de Basalto"] },
  { id: "orbital", god: "iris", name: "Cidade Orbital", common: ["vidro_colorido", "Vidro Colorido"], rare: ["prisma_vivo", "Prisma Vivo"] },
]);
const DOMAIN_BY_ID = new Map(DOMAINS.map((d) => [d.id, d]));
/** A9: os três deuses sem Domínio e a fonte do material deles. */
const OFF_DOMAIN = Object.freeze({
  aurion: { mat: ["brasa_solar", "Brasa Solar"], source: "fight:hall" },
  morkhan: { mat: ["cinza_das_correntes", "Cinza das Correntes"], source: "mob:elite" },
  bastor: { mat: ["barro_primordial", "Barro Primordial"], source: "minigame:paint" },
});

/** As 9 armas de linha (E8, formas da A11). `from` = Domínio (chefão no setor 10) ou fonte da A9. */
const LINE = Object.freeze([
  { id: "primeira_chama", name: "Espada da Primeira Chama", god: "aurion", family: "sword", keys: ["dmg", "power"] },
  { id: "tridente_mares", name: "Tridente das Marés", god: "maru", family: "heavy", keys: ["dmg", "power"], domain: "gelo" },
  { id: "lamina_correntes", name: "Lâmina das Correntes", god: "morkhan", family: "sword", keys: ["dmg", "power"] },
  { id: "martelo_incandescente", name: "Martelo Incandescente", god: "kragor", family: "heavy", keys: ["dmg", "power"], domain: "vulcao" },
  { id: "sabre_vendaval", name: "Sabre do Vendaval", god: "zephyra", family: "sword", keys: ["dmg", "acc"], domain: "canion" },
  { id: "arco_prismatico", name: "Arco Prismático", god: "iris", family: "bow", keys: ["dmg", "acc"], domain: "orbital" },
  { id: "garras_lunares", name: "Garras Lunares", god: "noctis", family: "gun", keys: ["dmg", "acc"], domain: "floresta" },
  { id: "arco_bronze_vivo", name: "Arco de Bronze Vivo", god: "aeryn", family: "bow", keys: ["dmg", "acc"], domain: "fabrica" },
  { id: "cajado_moldes", name: "Cajado dos Moldes", god: "bastor", family: "staff", keys: ["dmg", "power"] },
]);
const LINE_RARITY = "legendary";

/** Os 3 conjuntos da E7: 4 peças (elmo, peitoral, luvas, botas). `fallback` = chaves do tema quando a do conjunto não cabe no slot. */
const SETS = Object.freeze([
  { id: "vigilia", name: "Vigília", domain: "floresta", keys: ["def", "hp"], fallback: ["int", "warn", "dex"] },
  { id: "forja", name: "Forja", domain: "vulcao", keys: ["dmg", "power"], fallback: ["acc", "dex", "stam", "warn", "def"] },
  { id: "sentinela", name: "Sentinela de Bronze", domain: "fabrica", keys: ["def", "stam"], fallback: ["hp", "spd", "dex"] },
]);
const SET_RARITY = "rare";
const SET_PIECES = Object.freeze([
  { slot: "helm", suffix: "elmo", label: "Elmo" },
  { slot: "chest", suffix: "peitoral", label: "Peitoral" },
  { slot: "gloves", suffix: "luvas", label: "Luvas" },
  { slot: "boots", suffix: "botas", label: "Botas" },
]);

/** Fragmentos para fabricar, por raridade (§6.5). */
const FRAG_NEED = Object.freeze({ rare: 20, epic: 40, legendary: 60, mythic: 80 });
/** Chefão: 3 a 5 fragmentos por vitória + 10 na primeira (§6.5). */
const BOSS_FRAG = Object.freeze({ qty: [3, 5], first: 10 });

/** Escolhe as duas chaves de uma peça: primeiro as pedidas, depois o tema, depois o slot pelo peso. */
function pickKeys(slot, wanted) {
  const allowed = B.slotKeys(slot);
  const out = [];
  for (const k of [...wanted, ...allowed]) if (allowed.includes(k) && !out.includes(k)) out.push(k);
  return out.slice(0, 2);
}

const UNIVERSAL = Object.freeze([
  ["minerio_ferro", "Minério de Ferro", "common"],
  ["minerio_prata", "Minério de Prata", "uncommon"],
  ["lingote_refinado", "Lingote Refinado", "rare"],
  ["madeira_ancestral", "Madeira Ancestral", "uncommon"],
  ["cristal_bruto", "Cristal Bruto", "uncommon"],
  ["po_forja", "Pó de Forja", "common"],
  ["pedra_aprimoramento", "Pedra de Aprimoramento", "uncommon"],
  ["catalisador_refino", "Catalisador de Refino", "epic"],
  ["essencia_primordial", "Essência Primordial", "legendary"],
]);
/** Universais vêm do resto do jogo: não entram na conta de vitórias da fonte principal. */
const UNIVERSAL_IDS = new Set(UNIVERSAL.map((u) => u[0]));
const TOKENS = Object.freeze([
  ["po_refino", "Pó de Refino", "uncommon"],
  ["selo_dominio", "Selo de Domínio", "rare"],
]);

const fragSource = (w) => (w.domain ? `domain:${w.domain}:10` : OFF_DOMAIN[w.god].source);

function proposalItems() {
  const items = [];
  const add = (o) => items.push({ slot: null, keys: null, family: null, domain: null, set: null, twoHanded: false, ...o, tier: B.TIER[o.rarity] });
  for (const w of LINE) {
    add({ id: `linha_${w.id}`, category: "weapon", name: w.name, rarity: LINE_RARITY, slot: "weapon", family: w.family, twoHanded: ["heavy", "bow", "gun"].includes(w.family), domain: w.domain || w.god, keys: pickKeys("weapon", w.keys) });
  }
  for (const s of SETS) {
    for (const p of SET_PIECES) {
      add({ id: `${s.id}_${p.suffix}`, category: "armor", name: `${p.label} da ${s.name}`, rarity: SET_RARITY, slot: p.slot, domain: s.domain, set: s.id, keys: pickKeys(p.slot, [...s.keys, ...s.fallback]) });
    }
  }
  for (const w of LINE) add({ id: `frag_${w.id}`, category: "fragment", name: `Fragmento: ${w.name}`, rarity: LINE_RARITY, domain: w.domain || w.god, fragment: { of: `linha_${w.id}`, need: FRAG_NEED[LINE_RARITY] } });
  for (const s of SETS) add({ id: `frag_${s.id}`, category: "fragment", name: `Fragmento do conjunto ${s.name}`, rarity: SET_RARITY, domain: s.domain, set: s.id, fragment: { of: `${s.id}_*`, need: FRAG_NEED[SET_RARITY] } });
  for (const [id, name, rarity] of UNIVERSAL) add({ id, category: "material", name, rarity });
  for (const d of DOMAINS) {
    add({ id: d.common[0], category: "material", name: d.common[1], rarity: "common", domain: d.id });
    add({ id: d.rare[0], category: "material", name: d.rare[1], rarity: "rare", domain: d.id });
  }
  for (const [god, o] of Object.entries(OFF_DOMAIN)) add({ id: o.mat[0], category: "material", name: o.mat[1], rarity: "uncommon", domain: god });
  for (const [id, name, rarity] of TOKENS) add({ id, category: "currency", name, rarity });
  for (const w of LINE) add({ id: `receita_${w.id}`, category: "recipe", name: `Receita: ${w.name}`, rarity: LINE_RARITY, domain: w.domain || w.god });
  for (const s of SETS) add({ id: `projeto_${s.id}`, category: "recipe", name: `Projeto: conjunto ${s.name}`, rarity: SET_RARITY, domain: s.domain, set: s.id });
  return items;
}

const craftEmeralds = (rarity, wins) => Math.round((wins * B.income(B.REF[B.TIER[rarity]])) / 10) * 10;

function proposalRecipes() {
  const recipes = [];
  for (const w of LINE) {
    const d = w.domain && DOMAIN_BY_ID.get(w.domain);
    const needs = { [`frag_${w.id}`]: FRAG_NEED[LINE_RARITY] };
    if (d) Object.assign(needs, { [d.common[0]]: 20, [d.rare[0]]: 3 });
    else needs[OFF_DOMAIN[w.god].mat[0]] = 18;
    Object.assign(needs, { lingote_refinado: 4, essencia_primordial: 1 });
    recipes.push({ id: `fabricar_${w.id}`, out: `linha_${w.id}`, recipe: `receita_${w.id}`, needs, coins: craftEmeralds(LINE_RARITY, 20), source: fragSource(w) });
  }
  const setMetal = { vigilia: "minerio_prata", forja: "minerio_ferro", sentinela: "minerio_ferro" };
  for (const s of SETS) {
    const d = DOMAIN_BY_ID.get(s.domain);
    for (const p of SET_PIECES) {
      recipes.push({ id: `fabricar_${s.id}_${p.suffix}`, out: `${s.id}_${p.suffix}`, recipe: `projeto_${s.id}`, needs: { [`frag_${s.id}`]: FRAG_NEED[SET_RARITY], [d.common[0]]: 12, [d.rare[0]]: 1, [setMetal[s.id]]: 10 }, coins: craftEmeralds(SET_RARITY, 10), source: `domain:${s.domain}:7-10` });
    }
  }
  return recipes;
}

/** Tabelas de saque iniciais (§5.4, §6.6). qty = [mín, máx]; `p` = chance; quantidade nunca cresce com o nível. */
function proposalLoot() {
  const T = {};
  const stone = { id: "pedra_aprimoramento", qty: [1, 1], p: B.STONE_PER_WIN };
  for (const g of ["paint", "jetpack", "noturno", "corrida", "gincana"]) {
    const t = { sure: [{ id: "minerio_ferro", qty: [1, 2] }], chance: [{ id: "po_forja", qty: [1, 1], p: 0.3 }], first: [] };
    if (g === "gincana" || g === "corrida") t.chance.push({ id: "madeira_ancestral", qty: [1, 1], p: 0.25 });
    if (g === "noturno" || g === "jetpack") t.chance.push({ id: "cristal_bruto", qty: [1, 1], p: 0.25 });
    if (g === "paint") {
      t.sure.push({ id: "frag_cajado_moldes", qty: [2, 3] });
      t.sure.push({ id: "barro_primordial", qty: [1, 2] });
      t.first.push({ id: "receita_cajado_moldes", qty: [1, 1] });
    }
    T[`minigame:${g}`] = t;
  }
  T["fight:laminas"] = { sure: [{ id: "po_forja", qty: [1, 1] }], chance: [stone, { id: "brasa_solar", qty: [1, 1], p: 0.35 }, { id: "lingote_refinado", qty: [1, 1], p: 0.15 }], first: [] };
  T["fight:boxe"] = { sure: [{ id: "minerio_prata", qty: [1, 1] }], chance: [stone], first: [] };
  T["fight:hall"] = { sure: [{ id: "frag_primeira_chama", qty: BOSS_FRAG.qty }, { id: "brasa_solar", qty: [1, 2] }], chance: [{ id: "catalisador_refino", qty: [1, 1], p: 0.2 }, { id: "essencia_primordial", qty: [1, 1], p: 0.1 }], first: [{ id: "frag_primeira_chama", qty: [BOSS_FRAG.first, BOSS_FRAG.first] }, { id: "receita_primeira_chama", qty: [1, 1] }] };
  for (const kind of Object.keys(F.MOB_SHEETS)) {
    T[`mob:${kind}`] = { sure: [{ id: "minerio_ferro", qty: [1, 2] }], chance: [stone, { id: "po_forja", qty: [1, 1], p: 0.3 }, { id: "cinza_das_correntes", qty: [1, 1], p: 0.35 }], first: [] };
  }
  T["mob:elite"] = { sure: [{ id: "frag_lamina_correntes", qty: BOSS_FRAG.qty }, { id: "cinza_das_correntes", qty: [1, 2] }], chance: [stone], first: [{ id: "frag_lamina_correntes", qty: [BOSS_FRAG.first, BOSS_FRAG.first] }, { id: "receita_lamina_correntes", qty: [1, 1] }] };
  for (const d of DOMAINS) {
    const set = SETS.find((s) => s.domain === d.id);
    const weapon = LINE.find((w) => w.domain === d.id);
    for (let s = 1; s <= 10; s++) {
      const n = 1 + Math.floor(s / 3);
      const rare = { id: d.rare[0], qty: [1, 1], p: r(0.05 + 0.03 * s, 2) };
      // o raro trava a fabricação: no chefão ele é garantido (§6.6); nos outros setores, chance.
      const t = { sure: s === 10 ? [{ id: d.common[0], qty: [n, n] }, { id: d.rare[0], qty: [1, 1] }] : [{ id: d.common[0], qty: [n, n] }], chance: [...(s === 10 ? [] : [rare]), stone, { id: "minerio_prata", qty: [1, 1], p: 0.2 }, { id: "cristal_bruto", qty: [1, 1], p: 0.15 }], first: [] };
      if (s >= 4) t.chance.push({ id: "lingote_refinado", qty: [1, 1], p: 0.25 });
      if (s >= 8) t.chance.push({ id: "catalisador_refino", qty: [1, 1], p: 0.1 });
      if (set && s >= 7) t.sure.push({ id: `frag_${set.id}`, qty: [2, 3] });
      if (set && s === 7) t.first.push({ id: `projeto_${set.id}`, qty: [1, 1] });
      if (s === 10) {
        t.sure.push({ id: `frag_${weapon.id}`, qty: BOSS_FRAG.qty }, { id: "selo_dominio", qty: [1, 1] });
        t.chance.push({ id: "essencia_primordial", qty: [1, 1], p: 0.25 });
        t.first.push({ id: `frag_${weapon.id}`, qty: [BOSS_FRAG.first, BOSS_FRAG.first] }, { id: `receita_${weapon.id}`, qty: [1, 1] });
      }
      T[`domain:${d.id}:${s}`] = t;
    }
  }
  return T;
}

/** Esperado por vitória e mínimo garantido de um item numa tabela. */
function yieldOf(table, id) {
  let exp = 0;
  let min = 0;
  let first = 0;
  for (const e of table.sure) if (e.id === id) { exp += (e.qty[0] + e.qty[1]) / 2; min += e.qty[0]; }
  for (const e of table.chance) if (e.id === id) exp += (e.p * (e.qty[0] + e.qty[1])) / 2;
  for (const e of table.first) if (e.id === id) first += e.qty[0];
  return { exp, min, first };
}

/** Vitórias para juntar `need` de um item numa só fonte: esperado e pior caso (só com o garantido). */
function winsFor(table, id, need) {
  const y = yieldOf(table, id);
  if (y.exp <= 0) return null;
  const rest = Math.max(0, need - y.first);
  return { exp: Math.ceil(rest / y.exp - 1e-9), worst: y.min > 0 ? Math.ceil(rest / y.min - 1e-9) : null, sure: y.min > 0 };
}

/** I9 — vitórias de chefão por raridade (fragmento, 3 a 5 + 10 na primeira). */
function bossWinsByRarity() {
  const boss = { sure: [{ id: "x", qty: BOSS_FRAG.qty }], chance: [], first: [{ id: "x", qty: [BOSS_FRAG.first, BOSS_FRAG.first] }] };
  return Object.entries(FRAG_NEED).map(([rarity, need]) => ({ rarity, need, ...winsFor(boss, "x", need) }));
}

/** Para cada receita: vitórias na fonte principal por ingrediente que cai nela. */
function craftWins(recipes, loot) {
  return recipes.map((rc) => {
    const srcs = rc.source.includes(":7-10") ? [7, 8, 9, 10].map((s) => rc.source.replace("7-10", s)) : [rc.source];
    const per = {};
    for (const [id, need] of Object.entries(rc.needs)) {
      if (UNIVERSAL_IDS.has(id)) continue;
      const ys = srcs.map((s) => yieldOf(loot[s], id));
      const exp = ys.reduce((a, y) => a + y.exp, 0) / ys.length;
      if (exp <= 0) continue;
      const min = ys.reduce((a, y) => a + y.min, 0) / ys.length;
      const first = srcs.length > 1 ? 0 : ys[0].first;
      const rest = Math.max(0, need - first);
      per[id] = { need, exp: Math.ceil(rest / exp - 1e-9), worst: min > 0 ? Math.ceil(rest / min - 1e-9) : null };
    }
    const vals = Object.values(per);
    return { id: rc.id, source: rc.source, per, wins: Math.max(...vals.map((v) => v.exp)) };
  });
}

/** Total de vitórias nos setores 7–10 para o conjunto inteiro (4 peças). */
function setWins(recipes, loot) {
  return SETS.map((s) => {
    const rs = recipes.filter((rc) => rc.out.startsWith(`${s.id}_`));
    const total = {};
    for (const rc of rs) for (const [id, n] of Object.entries(rc.needs)) total[id] = (total[id] || 0) + n;
    const fake = { id: `conjunto_${s.id}`, out: s.id, needs: total, source: `domain:${s.domain}:7-10` };
    const w = craftWins([fake], loot)[0];
    return { set: s.id, name: s.name, domain: s.domain, needs: total, per: w.per, wins: w.wins, worst: Math.max(...Object.values(w.per).map((v) => v.worst || 0)) };
  });
}

/** Bônus de conjunto (E7): 2 peças = 40% da fatia, 4 peças = 100%, nas duas chaves do conjunto. */
const setBonus = (s, n) => Object.fromEntries(s.keys.map((k) => [k, r(B.sourceCap(k, "set") * (n >= 4 ? 1 : n >= 2 ? 0.4 : 0), 4)]));

// ── os 106 equipamentos de hoje ─────────────────────────────────────────────

/** Slot da A4 para o item de hoje. */
function slotOfToday(it) {
  if (it.category === "weapon") return "weapon";
  if (it.category === "shield") return "offhand";
  if (it.category === "armor") return "chest";
  if (/^luvas_/.test(it.id)) return "gloves";
  if (/^botas_/.test(it.id)) return "boots";
  if (/^oculos_/.test(it.id)) return "helm";
  return "amulet";
}
/** Chave de hoje que não cabe no slot novo → a chave do slot que faz o mesmo papel. */
const TRANSLATE = Object.freeze({
  weapon: { warn: "acc", stam: "power", def: "power" },
  offhand: { dmg: "def", warn: "def", stam: "def", power: "def" },
  chest: { warn: "hp", power: "hp", dmg: "def" },
  gloves: { stam: "dex", warn: "acc", power: "dmg" },
  boots: { warn: "dex", power: "spd", dmg: "dex" },
  helm: { stam: "hp", power: "int", dmg: "acc" },
  amulet: { warn: "int", def: "hp" },
  relic: {},
});
function keysOfToday(it, slot) {
  const allowed = B.slotKeys(slot);
  const ordered = Object.entries(it.bonus || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k]) => (allowed.includes(k) ? k : TRANSLATE[slot][k] || allowed[0]));
  if (!ordered.length && it.category === "weapon") ordered.push("dmg");
  return pickKeys(slot, ordered);
}
/** Bônus de hoje com o aprimoramento máximo de hoje (+10; só arma e proteção sobem). */
function todayMax(it) {
  const eq = { [Gear.slotsFor(it)[0]]: { id: it.id, level: Gear.UPGRADE.MAX } };
  return Gear.gearBonus(eq);
}
const ruleBonus = (slot, rarity, keys, plus, grade) => Object.fromEntries(keys.map((k, i) => [k, r(B.piece(k, slot, rarity, plus, grade, i === 0 ? 1 : B.SECONDARY), 4)]));

function todayGear() {
  const eq = Gear.GEAR.filter((g) => ["weapon", "shield", "armor", "accessory"].includes(g.category));
  return eq.map((it) => {
    const slot = slotOfToday(it);
    const keys = keysOfToday(it, slot);
    const nz = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v > 0));
    return { id: it.id, name: it.name, category: it.category, slot, rarity: it.rarity, today0: nz(it.bonus || {}), todayMax: nz(todayMax(it)), keys, rule0: ruleBonus(slot, it.rarity, keys, 0, 1), ruleMax: ruleBonus(slot, it.rarity, keys, B.PLUS_MAX, B.GRADE_MAX) };
  });
}

// ── saída ────────────────────────────────────────────────────────────────────

function all() {
  const items = proposalItems();
  const recipes = proposalRecipes();
  const loot = proposalLoot();
  const equip = items.filter((i) => i.slot).map((i) => ({ ...i, rule0: ruleBonus(i.slot, i.rarity, i.keys, 0, 1), ruleMax: ruleBonus(i.slot, i.rarity, i.keys, B.PLUS_MAX, B.GRADE_MAX) }));
  return {
    A: sectionA(), B: sectionB(), C: sectionC(), D: sectionD(), E: sectionE(), F: sectionF(), G: sectionG(),
    items, equip, recipes, loot, bossWins: bossWinsByRarity(), craft: craftWins(recipes, loot), sets: setWins(recipes, loot),
    setBonus: SETS.map((s) => ({ set: s.id, two: setBonus(s, 2), four: setBonus(s, 4) })), today: todayGear(),
  };
}

function printText(x) {
  const log = console.log;
  log("A) Por nível: vida | ataque e defesa do nível | equipamento plano 150 em % | XP p/ o próximo | vitórias p/ subir (mesmo nível)");
  for (const a of x.A) log(`  ${a.L} | ${a.hp} | ${a.atkDef} | ${a.flat150}% | ${a.xp} | ${a.wins}`);
  log("\nB) I1 — luta igual (Arena), atributo na paridade: golpes para matar/ataques para morrer | variação dos golpes");
  for (const [kind, b] of Object.entries(x.B)) log(`  ${kind}  ${b.rows.map((v) => `${v.L}: ${v.swings}/${v.attacks}`).join("  ")}  | ${r(b.spread * 100, 1)}%`);
  log("\nC) I2 — equipamento no teto: quanto multiplica a troca | hoje | proporcional (dano+defesa) | com vida +25% | equivale a níveis de ataque hoje × proporcional");
  for (const c of x.C) log(`  ${c.L} | ×${c.today} | ×${c.prop} | ×${c.propHp} | ${c.flatLevels} × ${c.propLevels}`);
  log("\nD) I5 — atributo pelo drop da luta (adulto, 15 por vitória) × régua do nível | hoje | com o freio da A14");
  for (const d of x.D) log(`  ${d.L} | vitórias ${d.wins} | hoje: acuracidade ${d.acc} = ${d.accX}×, velocidade ${d.spd} = ${d.spdX}×, Brutamontes acerta ${d.bruteHit}% | A14: acuracidade ${d.accPX}×, velocidade ${d.spdPX}×, Brutamontes ${d.bruteHitP}%, Ciborgue ${d.cibHitP}%`);
  log("\nE) I6 — monstro da rua: quanto a régua dele passa da do herói (hoje) | níveis a mais pela A15 (×1,10 ×1,25 ×1,40 ×1,60)");
  x.E.today.forEach((e, i) => log(`  ${e.L} | ${Object.entries(e.over).map(([k, v]) => `+${k}: +${v}%`).join(" | ")} || ${Object.values(x.E.proposal[i].plus).map((v) => `+${v}`).join(" ")}`));
  log("\nF) I3 — régua: build focado em cada chave (mítico +15 grau V + conjunto, runas, despertar, encanto)");
  for (const f of x.F.rows) log(`  ${f.k} | peças ${f.pieces} | total ${f.total} | teto ${f.cap}`);
  const s = x.F.sample;
  log(`  arma, dano: comum +0 ${s.common0} · rara +0 ${s.rare0} · lendária +10 I ${s.legendary10} · mítica +15 V ${s.mythic15V}`);
  log("\nG) I8 — custo do +0 ao +15 em Esmeraldas");
  for (const t of x.G.tiers) log(`  T${t.tier} (nível de referência ${t.L}, ${t.perWin} por vitória): ${t.steps.join(", ")}`);
  log(`  pedras: ${B.STONES.join(", ")} = ${x.G.stones} · a ${B.STONE_PER_WIN} por vitória = ${x.G.stoneWins} vitórias por peça, em qualquer nível`);
  log(`  moeda: ${x.G.winsTotal} vitórias no nível de referência; no nível 200 um T6 custa ${x.G.t6at200} vitórias`);
  log(`  a moeda fica mais barata que o material a partir do nível: ${Object.entries(x.G.crossing).map(([t, L]) => `T${t} ${L}`).join(" · ")}`);
}

// markdown (GDD)
const n = (v, d = 2) => {
  if (v === null || v === undefined) return "—";
  const s = String(r(v, d));
  const [i, f] = s.split(".");
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return f ? `${int},${f}` : int;
};
const KEY_PT = { dmg: "ataque", def: "defesa", hp: "vida", acc: "acuracidade", spd: "velocidade", int: "inteligência", dex: "destreza", stam: "fôlego", warn: "aviso", power: "barra" };
const RAR_PT = { common: "comum", uncommon: "incomum", rare: "raro", epic: "épico", legendary: "lendário", mythic: "mítico" };
const SLOT_PT = { weapon: "arma", offhand: "mão sec.", helm: "elmo", chest: "peitoral", gloves: "luvas", boots: "botas", amulet: "amuleto", relic: "relíquia" };
const bon = (o) => (Object.keys(o).length ? Object.entries(o).map(([k, v]) => `${k} ${n(v, 3)}`).join(" · ") : "nenhum");
const row = (cells) => `| ${cells.join(" | ")} |`;
const head = (cells) => `${row(cells)}\n${row(cells.map(() => "---"))}`;
const qty = (q) => (q[0] === q[1] ? `${q[0]}` : `${q[0]}–${q[1]}`);

function printMd(x) {
  const out = [];
  const p = (s = "") => out.push(s);
  p("### A. Por nível (regra em uso)");
  p(head(["Nível", "Vida", "Ataque e defesa do nível", "Equip. plano 150 em %", "XP p/ o próximo", "Vitórias p/ subir"]));
  for (const a of x.A) p(row([a.L, n(a.hp, 0), n(a.atkDef, 0), `${n(a.flat150, 1)}%`, n(a.xp, 0), n(a.wins, 0)]));
  p();
  p("### B. I1 — luta igual: golpes para matar (atributo na paridade)");
  p(head(["Tipo", ...I1_LEVELS.map((L) => `nv ${L}`), "Variação"]));
  for (const [kind, b] of Object.entries(x.B)) p(row([kind, ...b.rows.map((v) => n(v.swings, 1)), `${n(b.spread * 100, 1)}%`]));
  p();
  p("### C. I2 — equipamento no teto: quanto multiplica a troca de golpes");
  p(head(["Nível", ...LEVELS.map(String)]));
  p(row(["Hoje (soma plana de 150)", ...x.C.map((c) => `×${n(c.today)}`)]));
  p(row(["Proporcional, dano + defesa (A12)", ...x.C.map((c) => `×${n(c.prop)}`)]));
  p(row(["Proporcional + vida 0,25", ...x.C.map((c) => `×${n(c.propHp)}`)]));
  p(row(["Equip. vale níveis de ataque (hoje)", ...x.C.map((c) => n(c.flatLevels, 1))]));
  p(row(["Equip. vale níveis de ataque (A12)", ...x.C.map((c) => n(c.propLevels, 1))]));
  p();
  p("### D. I5 — atributo só por vitórias (adulto, 15 por vitória)");
  p(head(["Nível", "Vitórias", "Acurac. hoje ×régua", "Veloc. hoje ×régua", "Brutamontes acerta (hoje)", "Acurac. A14 ×régua", "Veloc. A14 ×régua", "Brutamontes (A14)", "Ciborgue (A14)"]));
  for (const d of x.D) p(row([d.L, n(d.wins, 0), n(d.accX), n(d.spdX), `${d.bruteHit}%`, n(d.accPX), n(d.spdPX), `${d.bruteHitP}%`, `${d.cibHitP}%`]));
  p();
  p("### E. I6 — monstro da rua");
  p(head(["Nível do herói", "+3 (hoje)", "+10", "+12", "+20", "A15 ×1,10", "×1,25", "×1,40", "×1,60"]));
  x.E.today.forEach((e, i) => p(row([e.L, ...Object.values(e.over).map((v) => `+${v}%`), ...Object.values(x.E.proposal[i].plus).map((v) => `+${v}`)])));
  p();
  p("### F. I3 — régua: build focado em cada chave");
  p(head(["Chave", "Peças (base+aprim.+refino)", "Total com conjunto, runas, despertar, encanto", "Teto"]));
  for (const f of x.F.rows) p(row([`\`${f.k}\` (${KEY_PT[f.k]})`, n(f.pieces, 4), n(f.total, 4), n(f.cap, 2)]));
  const s = x.F.sample;
  p();
  p(`Dano na arma: comum +0 = ${n(s.common0, 4)} · rara +0 = ${n(s.rare0, 4)} · lendária +10 grau I = ${n(s.legendary10, 4)} · mítica +15 grau V = ${n(s.mythic15V, 4)} (${n((s.mythic15V / B.CAP.dmg) * 100, 0)}% do teto).`);
  p();
  p("### G. I8 — Esmeraldas do aprimoramento, por tier");
  p(head(["Tier", "Nível de ref.", "Por vitória", ...B.WINS.map((_, i) => `+${i + 1}`), "Total"]));
  for (const t of x.G.tiers) p(row([`T${t.tier}`, t.L, n(t.perWin, 0), ...t.steps.map((v) => n(v, 0)), n(t.steps.reduce((a, b) => a + b, 0), 0)]));
  p(row(["Pedras", "—", "—", ...B.STONES.map(String), String(x.G.stones)]));
  p();
  p(`Pedras a ${n(B.STONE_PER_WIN, 1)} por vitória = **${x.G.stoneWins} vitórias por peça** em qualquer nível. A moeda custa ${x.G.winsTotal} vitórias no nível de referência; um T6 no nível 200 custa ${x.G.t6at200}. A moeda passa a custar menos que o material nos níveis: ${Object.entries(x.G.crossing).map(([t, L]) => `T${t} ${L}`).join(" · ")}.`);
  p();
  p("### H. Itens novos da versão jogável — equipamentos (bônus pela régua, `piece()`)");
  p(head(["id", "Nome", "Raridade", "Tier", "Slot", "Família", "Duas mãos", "Domínio/deus", "Chaves (principal · secundária)", "Bônus +0 grau I", "Bônus +15 grau V"]));
  for (const i of x.equip) p(row([`\`${i.id}\``, i.name, RAR_PT[i.rarity], `T${i.tier}`, SLOT_PT[i.slot], i.family || "—", i.twoHanded ? "sim" : "não", i.domain, i.keys.map((k) => `\`${k}\``).join(" · "), bon(i.rule0), bon(i.ruleMax)]));
  p();
  p("### I. Itens novos — fragmentos, materiais, fichas e receitas");
  p(head(["id", "Nome", "Categoria", "Raridade", "Tier", "Domínio/deus", "Fragmento de (precisa)"]));
  for (const i of x.items.filter((i) => !i.slot)) p(row([`\`${i.id}\``, i.name, i.category, RAR_PT[i.rarity], `T${i.tier}`, i.domain || "todos", i.fragment ? `\`${i.fragment.of}\` (${i.fragment.need})` : "—"]));
  p();
  const counts = {};
  for (const i of x.items) counts[i.category] = (counts[i.category] || 0) + 1;
  p(`Total: **${x.items.length} definições novas** (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ")}).`);
  p();
  p("### J. Receitas");
  p(head(["Receita", "Fabrica", "Aprende com", "Precisa", "Esmeraldas", "Fonte principal"]));
  for (const rc of x.recipes) p(row([`\`${rc.id}\``, `\`${rc.out}\``, `\`${rc.recipe}\``, Object.entries(rc.needs).map(([k, v]) => `${v} \`${k}\``).join(" · "), n(rc.coins, 0), `\`${rc.source}\``]));
  p();
  p("### K. Vitórias para fabricar");
  p("Por raridade (fragmento de chefão: 3 a 5 por vitória + 10 na primeira):");
  p();
  p(head(["Raridade", "Fragmentos", "Vitórias (esperado)", "Pior caso", "Pior ÷ esperado"]));
  for (const b of x.bossWins) p(row([RAR_PT[b.rarity], b.need, b.exp, b.worst, n(b.worst / b.exp)]));
  p();
  p("Por receita, só com o que cai na fonte principal (os universais vêm do resto do jogo):");
  p();
  p(head(["Receita", "Fonte", "Por ingrediente (esperado / pior caso)", "Vitórias"]));
  for (const c of x.craft) p(row([`\`${c.id}\``, `\`${c.source}\``, Object.entries(c.per).map(([k, v]) => `\`${k}\` ${v.exp}/${v.worst === null ? "chance" : v.worst}`).join(" · "), c.wins]));
  p();
  p("Conjunto inteiro (4 peças) nos setores 7 a 10 (alvo 25 a 40):");
  p();
  p(head(["Conjunto", "Domínio", "Total de ingredientes", "Vitórias (esperado)", "Pior caso do garantido", "Bônus 2 peças", "Bônus 4 peças"]));
  x.sets.forEach((st, i) => p(row([st.name, st.domain, Object.entries(st.needs).map(([k, v]) => `${v} \`${k}\``).join(" · "), st.wins, st.worst, bon(x.setBonus[i].two), bon(x.setBonus[i].four)])));
  p();
  p("### L. Tabelas de saque iniciais (por vitória; `p` = chance; quantidade não cresce com o nível)");
  p(head(["Tabela", "Garantido", "Chance", "Primeira vitória"]));
  const fmtE = (l) => (l.length ? l.map((e) => `${qty(e.qty)} \`${e.id}\`${e.p !== undefined ? ` (${n(e.p * 100, 0)}%)` : ""}`).join(" · ") : "nada");
  for (const [id, t] of Object.entries(x.loot)) p(row([`\`${id}\``, fmtE(t.sure), fmtE(t.chance), fmtE(t.first)]));
  p();
  p(`### M. Os ${x.today.length} equipamentos de hoje: bônus atual × régua`);
  p(head(["id", "Nome", "Slot (A4)", "Raridade", "Hoje +0", "Hoje +10", "Chaves pela régua", "Régua +0 grau I", "Régua +15 grau V"]));
  for (const t of x.today) p(row([`\`${t.id}\``, t.name, SLOT_PT[t.slot], RAR_PT[t.rarity], bon(t.today0), bon(t.todayMax), t.keys.map((k) => `\`${k}\``).join(" · "), bon(t.rule0), bon(t.ruleMax)]));
  console.log(out.join("\n"));
}

module.exports = { sectionD, sectionE, duel, evenFight, ruler, dropPace, levelForFactor, STREET_FACTORS, all, proposalItems, proposalRecipes, proposalLoot, bossWinsByRarity, craftWins, setWins, todayGear, I1_LEVELS, LEVELS };

/** E3: as tabelas de saque em uso (catalog/loot.js), por vitória e por minuto ativo. */
function lootLive() {
  const Items = require("../src/utils/mmItems");
  const out = {};
  for (const table of Object.keys(Items.LOOT_TABLES)) {
    const at = (win, min) => Items.lootExpectation(table, { win, activeMs: min * 60000 });
    out[table] = { win4: at(true, 4), lose4: at(false, 4), win1: at(true, 1), win8: at(true, 8) };
  }
  return out;
}

function printLoot(x) {
  const fmt = (e) => Object.entries(e).map(([id, v]) => `${id} ${v.expected} (mín ${v.min}, máx ${v.max})`).join(" · ") || "nada";
  console.log("Saque em uso (E3): esperado por luta/partida; o nível não entra na conta.");
  console.log();
  for (const [table, t] of Object.entries(x)) {
    console.log(table);
    console.log("  vitória, 4 min ativos:", fmt(t.win4));
    console.log("  derrota, 4 min ativos:", fmt(t.lose4));
    console.log("  vitória, 1 min / 8 min:", fmt(t.win1), "|", fmt(t.win8));
    const perMin = Object.fromEntries(Object.entries(t.win4).map(([id, v]) => [id, Math.round((v.expected / 4) * 1000) / 1000]));
    console.log("  por minuto ativo (vitória, 4 min):", Object.entries(perMin).map(([k, v]) => `${k} ${v}`).join(" · "));
  }
}
module.exports.lootLive = lootLive;

if (require.main === module) {
  if (process.argv.includes("--loot")) {
    const l = lootLive();
    if (process.argv.includes("--json")) console.log(JSON.stringify(l, null, 2));
    else printLoot(l);
    return;
  }
  const x = all();
  if (process.argv.includes("--json")) console.log(JSON.stringify(x, null, 2));
  else if (process.argv.includes("--md")) printMd(x);
  else printText(x);
}
