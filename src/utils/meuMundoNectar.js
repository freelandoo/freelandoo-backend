// src/utils/meuMundoNectar.js — MEU MUNDO 3D, lore v2 N2: o NÉCTAR DA SEMANA.
//
// O néctar não vem de cada partida: vem UMA VEZ por semana, da POSIÇÃO no
// placar semanal de cada jogável (N1, utils/meuMundoScores.js). Tabela do Alex
// (roteiro, decisão D2):
//   1º           = 10 L
//   2º ao 10º    = 4,0 L caindo 0,25 L por posição até 2,0 L
//   fora do top 10, quem pontuou = 1 L
// Dentro do mesmo jogo vale só a posição (não soma); entre os jogos, os litros
// somam (até 90 L por semana para quem é 1º nos 9). Empate fica com quem fez a
// marca primeiro (o placar já desempata por `best_at`).
//
// Contas em MILILITROS inteiros (0,25 L = 250 mL): nada de vírgula no banco.
//
// FECHAMENTO (decisão D6): a semana vai de domingo 00:00 a sábado 23:59 de
// Brasília; depois do sábado ela pode fechar. Quem fecha é o servidor, uma vez
// só (MeuMundoNectarService.closeWeek, com trava e recibo por conta × semana ×
// jogo). O crédito vai para a carteira "néctar para entregar" da CONTA; a
// entrega na estátua é a N3 (só domingo).
"use strict";

const S = require("./meuMundoScores");

const ML_PER_L = 1000;
const FIRST_ML = 10000;
const SECOND_ML = 4000;
const STEP_ML = 250;
const TOP = 10;
const SCORED_ML = 1000;

/** Mililitros de uma posição (1 = primeiro). `scored` = a pessoa pontuou na semana. */
function mlFor(position, scored = true) {
  const p = Math.floor(Number(position));
  if (!Number.isFinite(p) || p < 1) return 0;
  if (p === 1) return FIRST_ML;
  if (p <= TOP) return SECOND_ML - (p - 2) * STEP_ML;
  return scored ? SCORED_ML : 0;
}

/** A tabela para a tela: posição → mL (11 = "fora do top 10, pontuou"). */
const TABLE = Object.freeze(
  Array.from({ length: TOP + 1 }, (_, i) => Object.freeze({ position: i + 1, outside: i === TOP, ml: mlFor(i + 1, true) }))
);

/** Instante (ms) em que a semana pode fechar: domingo 00:00 de Brasília seguinte. */
const closesAt = (week) => S.weekRange(week).end;

/** A semana que deve estar fechada em `now` (a anterior à atual). */
const weekToClose = (now) => S.previousWeek(S.weekOf(now));

/** A semana já acabou em `now`? */
const isClosable = (week, now) => S.isWeekId(week) && Number(now) >= closesAt(week);

/** Soma os mL de uma lista de prêmios `{ ml }`. */
const totalMl = (awards) => awards.reduce((a, x) => a + (Number(x.ml) || 0), 0);

module.exports = { ML_PER_L, TOP, TABLE, mlFor, closesAt, weekToClose, isClosable, totalMl };
