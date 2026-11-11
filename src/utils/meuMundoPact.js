// src/utils/meuMundoPact.js — MEU MUNDO 3D, lore v2 D4: o PACTO do deus vencido (regra pura).
//
// A lore (historia/v2/04-mundo-exploravel.md): "Vencer um deus não o mata. Força um pacto: por
// uma semana, o deus abençoa o povo de quem o venceu (néctar extra no minijogo dele)."
//
// Regra (decidida pela recomendação, roteiro D4):
//  • Vencer o chefão do setor 10 (luta re-simulada, recibo novo) abre um pacto de 7 DIAS para o
//    POVO da conta (raposa/vampiro) naquele Domínio. Enquanto o pacto do povo está de pé, outra
//    vitória do mesmo povo não estica (senão o pacto seria eterno); acabou, a próxima abre outro.
//    Os dois povos podem ter pacto com o mesmo deus ao mesmo tempo.
//  • O bônus: +50% no néctar que o JOGÁVEL daquele deus rende no fechamento da semana (N2), para
//    toda conta do povo. O pacto de 7 dias quase sempre cruza duas semanas: cada semana leva a
//    fração do bônus pelo tempo de pacto dentro dela (7 dias inteiros = +50%; 3 dias = 3/7 disso).
//  • Robô não tem conta: nunca abre pacto nem recebe.
"use strict";

const S = require("./meuMundoScores");

const DAY_MS = 24 * 3600 * 1000;
const PACT_DAYS = 7;
const PACT_MS = PACT_DAYS * DAY_MS;
/** Bônus no néctar do jogável do deus (fração: 0,5 = +50%) com a semana inteira de pacto. */
const PACT_BONUS = 0.5;
const CLANS = Object.freeze(["raposa", "vampiro"]);

/** O jogável (placar da N1) de cada deus: a "janela" do Domínio dele. */
const GOD_GAME = Object.freeze({
  noctis: "noturno",
  zephyra: "corrida",
  maru: "gincana",
  aeryn: "jetpack",
  kragor: "laminas",
  iris: "paint",
});

const gameOfGod = (god) => GOD_GAME[god] || null;

/** Quanto do intervalo [a0, a1) cai dentro de [b0, b1) (ms). */
const overlapMs = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * Fração do bônus que a semana leva (0–1) pelos pactos `{ startsAt, endsAt }` (ms) dela.
 * Os pactos de um povo num Domínio nunca se sobrepõem; mesmo assim a soma tem teto em 1.
 */
function weekShare(week, pacts) {
  const r = S.weekRange(week);
  const len = r.end - r.start;
  const sum = (pacts || []).reduce((a, p) => a + overlapMs(Number(p.startsAt), Number(p.endsAt), r.start, r.end), 0);
  return Math.min(1, sum / len);
}

/** Mililitros extras de um prêmio `ml` com a fração `share` da semana sob pacto. */
const bonusMl = (ml, share) => Math.max(0, Math.round((Number(ml) || 0) * PACT_BONUS * Math.min(1, Math.max(0, Number(share) || 0))));

/** O pacto novo que uma vitória abre em `now` (ms). */
const window = (now) => ({ startsAt: Number(now), endsAt: Number(now) + PACT_MS });

module.exports = { PACT_DAYS, PACT_MS, PACT_BONUS, CLANS, GOD_GAME, gameOfGod, overlapMs, weekShare, bonusMl, window };
