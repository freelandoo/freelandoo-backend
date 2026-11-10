// src/utils/meuMundoTrainer.js — MEU MUNDO 3D, lore v2 F2: nível do TREINADOR.
//
// Regra pura (sem banco). O treinador é a CONTA (tb_mm_trainer, mig 437): o nível
// dele não zera ao trocar de personagem; o nível de AVENTURA continua por
// personagem (meuMundoAdventure.js, mig 435). Os 10 capítulos abrem pelo nível do
// treinador (1 a 30) — MEU MUNDO 3D/historia/v2/03-capitulos.md.
//
// De onde vem o XP (decisão do Alex, 09/11): o XP INTEIRO das missões + uma fração
// de tudo (minijogo, luta, Domínio, cuidar e treinar). A fração tem TETO POR DIA de
// Brasília, para a história andar no ritmo de "uma semana de jogo por capítulo"
// e não disparar com uma tarde de lutas contra monstro de nível alto.
//
// Curva (proposta, aguardando o Alex): XP acumulado para CHEGAR ao nível L =
// round(BASE × (L − 1)^EXP). Quase plana (~410 a ~490 por nível até o 30), sem
// teto depois. Calibrada para: missões do capítulo + ~600 de jogo por semana
// (5 dias no teto de 120) ⇒ capítulo k começa ~k semanas depois e o nível 30
// chega no fim do capítulo 10. Tabela em trainerTable().
"use strict";

const Life = require("./meuMundoLife");

const CURVE = Object.freeze({ BASE: 400, EXP: 1.05 });

/** XP acumulado para chegar ao nível `level` (1 = 0). */
function xpForLevel(level) {
  const L = Math.max(1, Math.floor(Number(level) || 1));
  return L <= 1 ? 0 : Math.round(CURVE.BASE * Math.pow(L - 1, CURVE.EXP));
}

/** Nível pelo XP total: { level, into, need, total } (need = custo do nível atual ao próximo). */
function trainerLevelOf(total) {
  const xp = Math.max(0, Math.floor(Number(total) || 0));
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level += 1;
  const base = xpForLevel(level);
  return { level, into: xp - base, need: xpForLevel(level + 1) - base, total: xp };
}

// ═══ GANHO ═══
const GAIN = Object.freeze({
  /** Missão: o XP do passo inteiro (sem teto). */
  quest: 1,
  /** Fração do XP de aventura que a atividade deu ao personagem. */
  share: Object.freeze({ minigame: 1, fight: 0.25, domain: 0.25 }),
  /** Cuidar: XP por refeição feita no dia (até `careMeals`). */
  carePerMeal: 5,
  careMeals: 3,
  /** Treinar: XP por hora ÚTIL inteira de treino ou estudo no dia (até `trainHours`). */
  trainPerHour: 5,
  trainHours: 9,
  /** Teto do dia (Brasília) para tudo que não é missão. */
  dailyCap: 120,
});

/** Quanto do ganho com teto ainda cabe no dia: `used` = gain_today se gain_day é hoje. */
function capRoom(used) {
  return Math.max(0, GAIN.dailyCap - Math.max(0, Math.floor(Number(used) || 0)));
}

/** XP do treinador que uma atividade rende ANTES do teto (`charXp` = XP de aventura que o personagem ganhou). */
function shareOf(source, charXp) {
  const k = GAIN.share[source];
  if (!k) return 0;
  return Math.max(0, Math.round(k * Math.max(0, Number(charXp) || 0)));
}

/** Unidades de cuidar/treinar de um dia do diário da vida (só inteiras e até o limite). */
function dayUnits(dayAcc) {
  const hours = (dayAcc && dayAcc.hours) || {};
  // só as horas ÚTEIS (as primeiras do dia, as que rendem atributo) contam
  const cap = Life.ATTR.USEFUL_H;
  const h = (k) => Math.min(cap[k] || 0, Math.max(0, Number(hours[k]) || 0));
  const useful = Math.floor(h("training") + h("studying") + 1e-9);
  return {
    meals: Math.min(GAIN.careMeals, Math.max(0, Math.floor(Number(dayAcc && dayAcc.mealsEaten) || 0))),
    hours: Math.min(GAIN.trainHours, Math.max(0, useful)),
  };
}

/** A tabela para o Alex aprovar: nível → XP acumulado e custo do nível. */
function trainerTable(upTo = 30) {
  const out = [];
  for (let L = 1; L <= upTo; L++) out.push({ level: L, total: xpForLevel(L), need: xpForLevel(L + 1) - xpForLevel(L) });
  return out;
}

module.exports = { CURVE, GAIN, xpForLevel, trainerLevelOf, capRoom, shareOf, dayUnits, trainerTable };
