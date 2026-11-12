#!/usr/bin/env node
// scripts/mm-boss-wall.js — MEU MUNDO 3D (2026-11-12): a conta dos chefões "6 meses de jogo bem jogado".
//
// Não muda regra: mede. Monta o herói de um jogador depois de D dias (V vitórias por dia) pela regra
// real (XP de vitória contra monstro do próprio nível, drop de atributo de adulto com o freio da E5,
// equipamento pela régua da E7) e põe o ROBÔ do mm-domain-calibrate para lutar com o deus em fases.
//
//   node scripts/mm-boss-wall.js [--wins 20] [--n 40] [--days 180] [--boss noctis]
//   node scripts/mm-boss-wall.js --level 95     só mede a taxa por dia contra o nível dado
//   node scripts/mm-boss-wall.js --fit --domain canion --rar 0.75 --pmax 15
//       calibra os setores 1–9 do Domínio: dia de cada setor entre o deus anterior e o próprio
//       (DAYS_BY_DOMAIN), alvo = TARGET do setor; nível entre o deus anterior e o próprio, sem descer.
"use strict";

const F = require("../src/utils/meuMundoFight");
const A = require("../src/utils/meuMundoAdventure");
const B = require("../src/utils/mmItems/rules/budget");
const D = require("../src/utils/meuMundoDomains");
const { botInput } = require("./mm-domain-calibrate");

const args = process.argv.slice(2);
const opt = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const WINS = Number(opt("--wins", 20));
const N = Number(opt("--n", 40));
const DAYS = Number(opt("--days", 180));
const SECTOR = Number(opt("--sector", 10));
const DOMAIN = opt("--domain", null) || Object.keys(D.BOSS_BY_DOMAIN).find((d) => D.BOSS_BY_DOMAIN[d] === opt("--boss", "noctis"));
const BOSS = SECTOR === 10 ? D.BOSS_BY_DOMAIN[DOMAIN] : undefined;
const KIND = D.kindOf(DOMAIN, SECTOR);
/** Alvo de vitória do robô no dia-alvo (chefão: 50%). */
const TARGET = Number(opt("--target", 0.5));
/** Depois do primeiro deus: raridade média das peças (0,6 rara · 0,75 épica · 0,88 lendária) e teto do +N. */
/** Equipamento de quem chega a cada Domínio: [raridade média, teto do +N] (raro +10 antes do Selo de
 * Noctis; épico +15 depois; lendário +15 na Orbital). --rar/--pmax trocam para a conta. */
const GEAR_BY_DOMAIN = Object.freeze({ floresta: [0.6, 10], canion: [0.75, 15], gelo: [0.75, 15], fabrica: [0.75, 15], vulcao: [0.75, 15], orbital: [0.88, 15] });
const RARITY = Number(opt("--rar", (GEAR_BY_DOMAIN[DOMAIN] || [0.6])[0]));
const PLUS_MAX = Number(opt("--pmax", (GEAR_BY_DOMAIN[DOMAIN] || [0, 10])[1]));
const MAX_STEPS = 4 * 60 * 60;
const ruler = (L) => F.mobBase(L).rate;

/** Herói depois de `wins` vitórias: nível de aventura e atributos (drop de adulto com o freio da E5). */
function heroAfter(wins) {
  let L = 1, left = wins, acc = 25, spd = 25;
  for (;;) {
    const need = A.xpToNext(L) / A.fightXp("cavaleiro", L, true);
    const n = Math.min(left, need);
    for (let i = 0; i < Math.floor(n); i++) {
      acc += 6.75 * A.dropPace(acc, L);
      spd += 2.25 * A.dropPace(spd, L);
    }
    left -= n;
    if (left <= 0) break;
    L++;
  }
  // inteligência e destreza vêm de estudo/treino, não da luta: na régua do nível
  const R = ruler(L);
  return { level: L, stats: { strength: Math.round(acc), speed: Math.round(spd), intelligence: Math.round(R), dexterity: Math.round(R) } };
}

/**
 * Equipamento alcançável ANTES do primeiro deus: 8 peças raras, aprimoradas até +plus (sem Ascensão:
 * o Selo só cai do chefão → teto +10), grau I, com o conjunto do Domínio (4 peças). Cada chave pega em
 * média 75% do peso dos slots dela (uma peça carrega 2 chaves: principal 1, secundária 0,5).
 */
function gearAt(plus, set = true, rarity = RARITY) {
  const f = 0.4 * rarity + 0.2 * (plus / 15);
  const g = {};
  for (const k of ["dmg", "def", "hp", "acc", "spd"]) g[k] = B.CAP[k] * f * 0.75;
  if (set) {
    g.def += B.CAP.def * 0.1;
    g.hp += B.CAP.hp * 0.1;
  }
  return g;
}
/** +N médio das 8 peças pelo número de Pedras (0,5 por vitória; custo acumulado 1,1,2,2,3,4,5,6,8,10). */
function plusAfter(wins, plusMax = PLUS_MAX) {
  const cost = [1, 1, 2, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 22, 26];
  let stones = (wins * 0.5) / 8, p = 0;
  while (p < plusMax && stones >= cost[p]) stones -= cost[p++];
  return p;
}

function winRate(level, hero, gear, n = N, kind = KIND, boss = BOSS) {
  let wins = 0;
  for (let i = 0; i < n; i++) {
    const f = new F.Fight({ kind, level, hero: hero.level, tier: "domain", seed: 1000 + i * 7919, stats: hero.stats, gear, body: null, boss });
    const mem = { react: 0 };
    for (let k = 0; k < MAX_STEPS && !f.over; k++) f.step(botInput(f, mem));
    if (f.over && f.over.win) wins++;
  }
  return wins / n;
}

const at = (day, rarity = RARITY, plusMax = PLUS_MAX) => {
  const wins = day * WINS;
  const hero = heroAfter(wins);
  const plus = plusAfter(wins, plusMax);
  return { day, wins, hero, plus, gear: gearAt(plus, day >= 60, rarity) };
};

/** Dia (20 vitórias/dia) em que o deus de cada Domínio cai para metade dos robôs (proposta 2026-11-12). */
const GOD_DAY = Object.freeze({ floresta: 180, canion: 270, gelo: 365, fabrica: 455, vulcao: 545, orbital: 730 });
/** Dia-alvo de cada setor: a Floresta foi medida; os outros sobem em linha do deus anterior ao próprio. */
function sectorDay(domain, sector) {
  if (domain === "floresta") return [2, 4, 8, 13, 20, 30, 45, 75, 120, 180][sector - 1];
  const ids = D.DOMAIN_IDS, i = ids.indexOf(domain);
  const a = GOD_DAY[ids[i - 1]], b = GOD_DAY[domain];
  return Math.round(a + ((b - a) * sector) / 10);
}
/** Maior nível em [lo, hi] em que o herói ainda vence a fração `target`. */
function fitLevel(lo, hi, hero, gear, target, kind, boss) {
  if (winRate(lo, hero, gear, N, kind, boss) < target) return lo;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (winRate(mid, hero, gear, N, kind, boss) >= target) lo = mid; else hi = mid;
  }
  return lo;
}

if (require.main === module && args.includes("--fit")) {
  const ids = D.DOMAIN_IDS, i = ids.indexOf(DOMAIN);
  const floor = i > 0 ? D.LEVELS_BY_DOMAIN[ids[i - 1]][9] : 1;
  const god = D.LEVELS_BY_DOMAIN[DOMAIN][9];
  // cada setor sozinho (o tipo de luta muda a dureza: Garras é fácil, Golem e Brutamontes duros);
  // depois "nunca desce" de TRÁS para frente: um setor fácil fica abaixo do seguinte em vez de um
  // setor duro virar muro.
  const fit = [];
  for (let s = 1; s <= 9; s++) {
    const x = at(sectorDay(DOMAIN, s));
    fit.push(fitLevel(Math.round(floor * 0.6), god, x.hero, x.gear, D.TARGET[s - 1], D.kindOf(DOMAIN, s), undefined));
  }
  const out = fit.slice();
  for (let s = 7; s >= 0; s--) out[s] = Math.min(out[s], out[s + 1]);
  for (let s = 1; s <= 9; s++) {
    const x = at(sectorDay(DOMAIN, s)), L = out[s - 1];
    console.log(`setor ${s} · dia ${x.day} · herói nv ${x.hero.level} (+${x.plus}) · ${D.kindOf(DOMAIN, s)} → nv ${L} (sozinho ${fit[s - 1]}) · robô vence ${Math.round(winRate(L, x.hero, x.gear, N, D.kindOf(DOMAIN, s)) * 100)}% (alvo ${Math.round(D.TARGET[s - 1] * 100)}%)`);
  }
  const x = at(GOD_DAY[DOMAIN]);
  console.log(`setor 10 · dia ${x.day} · herói nv ${x.hero.level} · deus ${D.BOSS_BY_DOMAIN[DOMAIN]} nv ${god} · robô vence ${Math.round(winRate(god, x.hero, x.gear, N, D.kindOf(DOMAIN, 10), D.BOSS_BY_DOMAIN[DOMAIN]) * 100)}%`);
  console.log(JSON.stringify([...out, god]));
} else if (require.main === module) {
  const goal = at(DAYS);
  console.log(`${DOMAIN} setor ${SECTOR} ${BOSS ? `chefão ${BOSS} em fases` : ""} (${KIND}) · ${WINS} vitórias/dia · alvo: ${Math.round(TARGET * 100)}% no dia ${DAYS}`);
  console.log(`herói do dia ${DAYS}: nv ${goal.hero.level} · acuracidade ${goal.hero.stats.strength} · velocidade ${goal.hero.stats.speed} · peças +${goal.plus} · bônus ${Object.entries(goal.gear).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(" ")}`);
  let level = Number(opt("--level", 0));
  if (!level) {
    // maior nível em que o herói do dia-alvo ainda vence ~50%
    let lo = 1, hi = goal.hero.level * 4;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const w = winRate(mid, goal.hero, goal.gear);
      if (w >= TARGET) lo = mid; else hi = mid;
    }
    level = lo;
  }
  console.log(`\nnível do chefão: ${level} (régua ${Math.round(ruler(level))})`);
  console.log("dia | vitórias | nv herói | peças | robô vence");
  for (const d of [30, 60, 90, 120, 150, 180, 210, 240, 300, 365].filter((x) => x <= DAYS * 2.1)) {
    const x = at(d);
    console.log(`${String(d).padStart(3)} | ${String(x.wins).padStart(5)} | ${String(x.hero.level).padStart(3)} | +${String(x.plus).padStart(2)} | ${Math.round(winRate(level, x.hero, x.gear) * 100)}%`);
  }
}

/** O herói no dia-alvo do setor, com o equipamento de quem chega ao Domínio. */
const heroAt = (domain, sector) => at(sectorDay(domain, sector), ...(GEAR_BY_DOMAIN[domain] || [RARITY, PLUS_MAX]));
/** Taxa do robô com esse herói contra o monstro do setor (o deus em fases no 10). Para os testes. */
function sectorWinRate(domain, sector, n = N) {
  const x = heroAt(domain, sector);
  return winRate(D.sectorLevel(domain, sector), x.hero, x.gear, n, D.kindOf(domain, sector), D.bossOf(domain, sector) || undefined);
}

module.exports = { heroAfter, gearAt, plusAfter, at, heroAt, sectorDay, sectorWinRate, GOD_DAY, GEAR_BY_DOMAIN };
