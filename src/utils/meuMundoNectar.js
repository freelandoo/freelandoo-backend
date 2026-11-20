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

// O COLETOR DE NÉCTAR (19/11, pedido do Alex): no nível 5 do treinador a
// pessoa ganha o coletor, que aparece na tela de equipar e mostra tudo o que a
// conta já coletou (`earned_ml`, sem limite). Só mostra; não dá nada.
const COLLECTOR_LEVEL = 5;

/** O coletor está liberado neste nível do treinador? */
const collectorUnlocked = (trainerLevel) => Number(trainerLevel) >= COLLECTOR_LEVEL;

// O ROUBO DA NÍVEA (19/11, números aprovados pelo Alex): a Nívea controla os
// monstros pelos cristais verdes e roxos e quer o néctar de todo mundo. Perder
// (ou fugir) de um monstro da rua ou de um Domínio tira 10% do néctar que a
// conta CARREGA (`pending_ml`, ainda não entregue), no mínimo 0,1 L e no
// máximo 2 L. Com menos de 0,1 L, leva o que houver; com 0, nada. O que sai vai
// para o contador "Néctar da Nívea". O total coletado (`earned_ml`) não muda.
const THEFT_PCT = 0.1;
const THEFT_MIN_ML = 100;
const THEFT_MAX_ML = 2000;
/** De onde o monstro rouba: a rua e os Domínios (Arena, Boxe, Hall, deus e treino não). */
const THEFT_ORIGINS = Object.freeze(["mob", "domain"]);

/** mL que a derrota tira de quem carrega `pendingMl`. */
function theftMl(pendingMl) {
  const p = Math.max(0, Math.floor(Number(pendingMl) || 0));
  if (p <= 0) return 0;
  const cut = Math.min(THEFT_MAX_ML, Math.max(THEFT_MIN_ML, Math.round(p * THEFT_PCT)));
  return Math.min(p, cut);
}

/** A derrota nesta origem rouba néctar? */
const theftApplies = (origin, win) => !win && THEFT_ORIGINS.includes(origin);

module.exports = { ML_PER_L, TOP, TABLE, mlFor, closesAt, weekToClose, isClosable, totalMl, COLLECTOR_LEVEL, collectorUnlocked, THEFT_PCT, THEFT_MIN_ML, THEFT_MAX_ML, THEFT_ORIGINS, theftMl, theftApplies };
