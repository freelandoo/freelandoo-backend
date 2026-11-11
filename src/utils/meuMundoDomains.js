// src/utils/meuMundoDomains.js — MEU MUNDO 3D, lore v2 D1: os Seis Domínios (regra pura).
//
// A lore (historia/v2/04-mundo-exploravel.md): cada Domínio tem 10 setores; o
// setor 10 é o deus. Decisão do Alex (10/11): os seis são uma TRAVESSIA, em
// ordem fixa — só se chega ao próximo atravessando o anterior (vencer o setor
// 10 abre a passagem) E com o nível do treinador da tabela (5, 9, 13, 17, 21,
// 25). Quem já atravessou volta direto ao começo de qualquer Domínio aberto.
// Liberou o setor, ele fica livre para lutar de novo.
//
// O cliente NÃO tem cópia desta tabela: o GET /domains manda tudo pronto
// (aberto/fechado, setores, nível e Poder recomendado). Quem decide é o
// servidor (MeuMundoDomainService), o aparelho só desenha.
//
// Monstros: sem arte nova na D1, cada setor usa um corpo que já existe, na
// ordem da lore (1–3 comuns, 4–6 fortes, 7–8 elite, 9 guardião, 10 o deus). Os
// Lobos de Ferrugem já são o elite da Floresta. As fatias D2 e D5…D9 trocam
// os placeholders pelos mutantes de cada Domínio.
//
// Nível do monstro: pela régua do B7 (a soma dos status do monstro ≈ o Poder
// recomendado; o Brutamontes nv. 15 ≈ 2.300), o menor nível cuja soma alcança
// o Poder recomendado do setor, nunca menor que o do setor anterior. A D2
// calibrou a Floresta com robô lutando (LEVELS_BY_DOMAIN): a régua do B7 deixava
// tudo no nv. 1 e o robô vencia 100% dos setores.
"use strict";

const FightSim = require("./meuMundoFight");

const SECTORS = 10;

const DOMAINS = Object.freeze(
  [
    { id: "floresta", god: "noctis", need: 5, power: [150, 600], kit: "floresta" },
    { id: "canion", god: "zephyra", need: 9, power: [500, 1000], kit: "canion" },
    { id: "gelo", god: "maru", need: 13, power: [900, 1400], kit: "gelo" },
    { id: "fabrica", god: "aeryn", need: 17, power: [1300, 1800], kit: "fabrica" },
    { id: "vulcao", god: "kragor", need: 21, power: [1700, 2300], kit: "forja" },
    { id: "orbital", god: "iris", need: 25, power: [2200, 3000], kit: "orbital" },
  ].map((d) => Object.freeze({ ...d, power: Object.freeze(d.power) }))
);
const DOMAIN_IDS = Object.freeze(DOMAINS.map((d) => d.id));
const BY_ID = new Map(DOMAINS.map((d, i) => [d.id, { ...d, index: i }]));

/** Corpos de hoje por setor (placeholders até a fatia de cada Domínio). */
const SECTOR_KINDS = Object.freeze(["cavaleiro", "cavaleiro", "cavaleiro", "garras", "garras", "garras", "wolf", "wolf", "stone", "brute"]);
/**
 * D2 — a Floresta da Lua pela lore (historia/v2/04-mundo-exploravel.md §1). A REGRA da luta
 * é a de um tipo que já existe (sem tipo novo: a luta antiga não muda, sem RULES_VERSION);
 * quem a criatura É fica em FOES (nome da lore + o corpo que a desenha). Mutantes sem arte
 * (Mariposas, Cervo Oco, Coruja de Mil Olhos) seguem no corpo de placeholder até o Alex
 * mandar as peças (roteiro §4).
 *   1–2 Mariposas Cinzentas · 3–4 Cervos Ocos / Corujas de Mil Olhos (placeholders)
 *   5–6 Sonâmbulos (Raposas de olhos fechados: corpo da Raposa adulta, lutando de mão)
 *   7–8 Lobos de Ferrugem (elite, já existem) · 9 Selene de Sombra (Vampira adulta, espada)
 *   10 NOCTIS (o corpo do deus, de arma de fogo: a regra do Ciborgue + as fases da D4, BOSS_BY_DOMAIN)
 */
/**
 * D5 — o Cânion das Tempestades pela lore (§2), no mesmo molde:
 *   1–2 Abutres de Pó (animal; placeholder) · 3 Chacais de Vento (o bando dos lobos, placeholder)
 *   4–5 Mensageiros Sem Rosto (Raposas rápidas: regra da Dama, corpo da Raposa adulta de mão)
 *   6 Escorpião Para-raios (regra do Brutamontes, placeholder) · 7–8 Harpias (elite: a Dama das Garras,
 *   que nasceu como o tipo `harpy`) · 9 A Carta (redemoinho de papel e raio: regra do Golem de Pedra,
 *   o do raio reto; placeholder) · 10 ZÉPHYRA (corpo da deusa com a espada: regra do Cavaleiro + fases)
 */
const KINDS_BY_DOMAIN = Object.freeze({
  floresta: Object.freeze(["cavaleiro", "cavaleiro", "garras", "garras", "brute", "brute", "wolf", "wolf", "cavaleiro", "ciborgue"]),
  canion: Object.freeze(["cavaleiro", "cavaleiro", "wolf", "garras", "garras", "brute", "garras", "garras", "stone", "cavaleiro"]),
});

/**
 * Quem o monstro do setor É (lore) e o corpo que o desenha. `body` = skin que existe;
 * `rig` = luta com os golpes/arma do tipo (espada, arma de fogo); sem `rig` = de mão,
 * como o desafio do Hall. `art: false` = placeholder até a arte do Alex.
 */
const FOES_BY_DOMAIN = Object.freeze({
  floresta: Object.freeze([
    { id: "mariposa", art: false },
    { id: "mariposa", art: false },
    { id: "cervo", art: false },
    { id: "coruja", art: false },
    { id: "sonambulo", body: "raposa_adulto", art: true },
    { id: "sonambulo", body: "raposa_adulto", art: true },
    { id: "lobo", art: true },
    { id: "lobo", art: true },
    { id: "selene", body: "vampira_adulta", rig: true, art: false },
    { id: "noctis", body: "noctis", rig: true, art: true },
  ].map((f) => Object.freeze(f))),
  canion: Object.freeze([
    { id: "abutre", art: false },
    { id: "abutre", art: false },
    { id: "chacal", art: false },
    { id: "mensageiro", body: "raposa_adulto", art: false },
    { id: "mensageiro", body: "raposa_adulto", art: false },
    { id: "escorpiao", art: false },
    { id: "harpia", art: true },
    { id: "harpia", art: true },
    { id: "carta", art: false },
    { id: "zephyra", body: "zephyra", rig: true, art: true },
  ].map((f) => Object.freeze(f))),
});

/**
 * Nível do monstro calibrado com ROBÔ (scripts/mm-domain-calibrate.js --fit): a ficha com o
 * Poder recomendado do setor (a da lore) vence a fração TARGET do setor. Domínio sem tabela
 * cai na régua do B7 (sectorLevel).
 */
// D2 (2026-11-11, 80 lutas por ponto): o robô vence 91% no setor 1 (nv. 2), ~75–90% no meio e
// 35% contra Noctis (nv. 7, o chefão é mais duro de propósito).
const LEVELS_BY_DOMAIN = Object.freeze({
  floresta: Object.freeze([2, 2, 2, 2, 4, 4, 5, 6, 7, 7]),
  // D5 (2026-11-11, 80 lutas por ponto, herói 5 → 9): o robô vence 96% no setor 1 (nv. 5), 68–98% no
  // meio (setor 4 fica em 74%: o nível não desce do setor 3) e 54% contra Zéphyra com as fases (nv. 12).
  canion: Object.freeze([5, 6, 7, 7, 7, 8, 9, 10, 10, 12]),
});
/**
 * D4: o deus do setor 10 luta em FASES (regra `BOSSES` em meuMundoFight.js, setup.boss no
 * ticket). Domínio sem chefão com fases (ainda sem fatia) luta como antes.
 */
const BOSS_BY_DOMAIN = Object.freeze({ floresta: "noctis", canion: "zephyra" });
/** O chefão com fases do setor (só o 10), ou null. */
const bossOf = (domainId, sector) => (sector === SECTORS && BOSS_BY_DOMAIN[domainId]) || null;
/** Vitórias do robô com o Poder recomendado, do setor 1 ao 10 (o fim fica no deus). */
const TARGET = Object.freeze([0.9, 0.86, 0.82, 0.78, 0.74, 0.7, 0.66, 0.62, 0.56, 0.5]);
/**
 * Nível de aventura que o robô usa em cada setor (quem chega ao fundo já lutou mais). D5: a
 * travessia é em ordem, então quem chega a um Domínio já passou pelos anteriores — cada Domínio
 * começa 4 níveis acima do anterior (Floresta 1→5, Cânion 5→9, …; a Floresta não muda).
 */
const heroOf = (domainId, sector) => {
  const d = domainOf(domainId);
  return 1 + 4 * (d ? d.index : 0) + Math.floor((sector - 1) / 2);
};

/**
 * Lugares da cena: Pedraverde (a clareira com o Golem sentado) fica ao lado do setor 6 da Floresta.
 * `spots` = pontos dentro do lugar que também viram visita (C5: "golem", a ~4 m dele, sem arma).
 */
const PLACES_BY_DOMAIN = Object.freeze({
  floresta: Object.freeze([Object.freeze({ id: "pedraverde", sector: 6, spots: Object.freeze(["golem"]) })]),
});

/**
 * C5: o lugar já está ao alcance? A clareira fica ao lado do setor dela, então abre
 * junto com o setor (o anterior vencido). Devolve o lugar ou null.
 */
function placeOf(domainId, placeId) {
  return (PLACES_BY_DOMAIN[domainId] || []).find((p) => p.id === placeId) || null;
}
function placeOpen(domainId, placeId, best = {}, bypass = false) {
  const p = placeOf(domainId, placeId);
  if (!p) return false;
  return !!bypass || p.sector <= (Number(best[domainId]) || 0) + 1;
}

/** Os três palcos de luta por Domínio (entrada, setores fundos, palácio do deus). */
function stageOf(sector) {
  if (sector >= 9) return "palacio";
  if (sector >= 5) return "fundo";
  return "entrada";
}

const domainOf = (id) => BY_ID.get(String(id || "")) || null;
const sectorOk = (s) => Number.isInteger(s) && s >= 1 && s <= SECTORS;

/** Poder recomendado do setor (linear de 1 a 10, de 10 em 10). */
function recommendedPower(domainId, sector) {
  const d = domainOf(domainId);
  if (!d || !sectorOk(sector)) return null;
  const [a, b] = d.power;
  return Math.round((a + ((b - a) * (sector - 1)) / (SECTORS - 1)) / 10) * 10;
}

function foeOf(domainId, sector) {
  const list = FOES_BY_DOMAIN[domainId];
  const f = list && list[sector - 1];
  return f ? { id: f.id, body: f.body || null, rig: !!f.rig, art: !!f.art } : null;
}

function kindOf(domainId, sector) {
  const list = KINDS_BY_DOMAIN[domainId] || SECTOR_KINDS;
  return list[sector - 1];
}

/** Soma dos status do monstro no nível (vida + ataque + defesa + acuracidade + velocidade). */
function mobPower(kind, level) {
  const ms = FightSim.MOB_SHEETS[kind];
  const base = FightSim.mobBase(level);
  return (base.hp * ms[0] + base.rate * (ms[1] + ms[2] + ms[3] + ms[4])) / 100;
}

const LEVELS = new Map();
/** Nível do monstro de cada setor (pela régua do B7, sem descer de um setor para o outro). */
function sectorLevel(domainId, sector) {
  const d = domainOf(domainId);
  if (!d || !sectorOk(sector)) return null;
  if (!LEVELS.has(d.id) && LEVELS_BY_DOMAIN[d.id]) LEVELS.set(d.id, LEVELS_BY_DOMAIN[d.id]);
  if (!LEVELS.has(d.id)) {
    const out = [];
    let prev = 1;
    for (let s = 1; s <= SECTORS; s++) {
      const want = recommendedPower(d.id, s);
      const kind = kindOf(d.id, s);
      let L = prev;
      while (L < 200 && mobPower(kind, L) < want) L++;
      out.push(L);
      prev = L;
    }
    LEVELS.set(d.id, out);
  }
  return LEVELS.get(d.id)[sector - 1];
}

/**
 * Por que o Domínio está fechado (null = aberto).
 * `best` = { [domain]: maior setor vencido }; `bypass` = administrador.
 */
function lockOf(domainId, trainerLevel, best, bypass = false) {
  const d = domainOf(domainId);
  if (!d) return { code: "domain" };
  if (bypass) return null;
  const prev = d.index > 0 ? DOMAINS[d.index - 1] : null;
  // a travessia vem primeiro: quem não atravessou o anterior nem chega à porta
  if (prev && (Number(best[prev.id]) || 0) < SECTORS) return { code: "crossing", from: prev.id };
  if ((Number(trainerLevel) || 1) < d.need) return { code: "trainer", level: d.need };
  return null;
}

/** O setor está aberto? (o 1 abre com o Domínio; o N depois de vencer o N−1) */
function sectorOpen(domainId, sector, trainerLevel, best, bypass = false) {
  if (!sectorOk(sector)) return false;
  if (lockOf(domainId, trainerLevel, best, bypass)) return false;
  return bypass || sector <= (Number(best[domainId]) || 0) + 1;
}

/** A tela: os seis com setores, travas e a passagem para o próximo. */
function view(trainerLevel, best, bypass = false) {
  return DOMAINS.map((d, i) => {
    const lock = lockOf(d.id, trainerLevel, best, bypass);
    const top = Math.max(0, Math.min(SECTORS, Number(best[d.id]) || 0));
    const next = DOMAINS[i + 1] || null;
    return {
      id: d.id,
      god: d.god,
      kit: d.kit,
      need: d.need,
      open: !lock,
      lock,
      best: top,
      crossed: top >= SECTORS,
      // trecho de passagem: aparece depois do setor 10 vencido
      places: (PLACES_BY_DOMAIN[d.id] || []).map((p) => ({ id: p.id, sector: p.sector, spots: [...(p.spots || [])] })),
      passage: next && top >= SECTORS ? { to: next.id, open: !lockOf(next.id, trainerLevel, best, bypass) } : null,
      sectors: Array.from({ length: SECTORS }, (_, k) => {
        const s = k + 1;
        return {
          n: s,
          kind: kindOf(d.id, s),
          foe: foeOf(d.id, s),
          boss: bossOf(d.id, s),
          level: sectorLevel(d.id, s),
          power: recommendedPower(d.id, s),
          stage: stageOf(s),
          open: !lock && (bypass || s <= top + 1),
          cleared: s <= top,
        };
      }),
    };
  });
}

module.exports = {
  SECTORS,
  DOMAINS,
  DOMAIN_IDS,
  SECTOR_KINDS,
  KINDS_BY_DOMAIN,
  FOES_BY_DOMAIN,
  LEVELS_BY_DOMAIN,
  PLACES_BY_DOMAIN,
  BOSS_BY_DOMAIN,
  bossOf,
  placeOf,
  placeOpen,
  TARGET,
  heroOf,
  foeOf,
  domainOf,
  stageOf,
  recommendedPower,
  kindOf,
  mobPower,
  sectorLevel,
  lockOf,
  sectorOpen,
  view,
};
