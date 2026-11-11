// src/utils/meuMundoScores.js — MEU MUNDO 3D, lore v2 N1: o PLACAR SEMANAL.
//
// Cada jogável tem um ranking por semana (roteiro lore v2, trilha N; o néctar da
// N2 sai da posição nele). Quem grava é o SERVIDOR, na mesma transação do recibo
// da partida (MeuMundoAdventureService): sem recibo novo, nada entra — repetir
// a mesma partida não conta duas vezes. Robô não tem conta, então nunca entra.
//
// Como cada jogo conta (marca da semana, por pessoa):
//   best/desc  a MAIOR marca (pontos; no Paint, o dano causado — a mesma
//              regra que decide quem vence a partida)  Jetpack, Rolê, Paint
//   best/asc   a MENOR marca (tempo em ms; só quem chegou)  Antigravidade, Gincana
//   sum        a SOMA (vitórias em luta conferida)     Lâminas, Boxe, Hall
//   live       não grava: o Poder de agora (tb_mm_character.power)  Poder
// Empate: quem chegou na marca primeiro fica na frente.
//
// A SEMANA vai de domingo 00:00 a sábado 23:59 no horário de Brasília (decisão
// D6 do roteiro: fecha no sábado para a entrega cair no domingo). Brasília está
// em UTC−3 o ano todo desde 2019 (sem horário de verão). Id da semana = a data
// (AAAA-MM-DD) do domingo em que ela começa.
"use strict";

const BRT_OFFSET_MS = -3 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

const game = (id, kind, dir, unit) => Object.freeze({ id, kind, dir, unit });

/** Os jogáveis do placar, na ordem da tela. */
const GAMES = Object.freeze([
  game("jetpack", "best", "desc", "pts"),
  game("noturno", "best", "desc", "pts"),
  game("corrida", "best", "asc", "ms"),
  game("gincana", "best", "asc", "ms"),
  game("paint", "best", "desc", "pts"),
  game("laminas", "sum", "desc", "wins"),
  game("boxe", "sum", "desc", "wins"),
  game("hall", "sum", "desc", "wins"),
  game("poder", "live", "desc", "pts"),
]);
const GAME_BY_ID = new Map(GAMES.map((g) => [g.id, g]));
/** Os que gravam em tb_mm_score (o CHECK da mig 440 é esta lista). */
const STORED = Object.freeze(GAMES.filter((g) => g.kind !== "live").map((g) => g.id));
/** Origens de luta que contam vitória no placar (o recibo "fight" tem `origin`). */
const FIGHT_GAMES = Object.freeze(["laminas", "boxe", "hall"]);

/** Id da semana (domingo, AAAA-MM-DD, Brasília) de um instante em ms. */
function weekOf(ms) {
  const local = new Date(Number(ms) + BRT_OFFSET_MS); // relógio de Brasília lido como UTC
  const dow = local.getUTCDay(); // 0 = domingo
  const sunday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - dow * DAY_MS);
  return sunday.toISOString().slice(0, 10);
}

/** Início e fim (exclusivo) da semana, em ms UTC. */
function weekRange(week) {
  const start = Date.parse(`${week}T00:00:00Z`) - BRT_OFFSET_MS;
  return { start, end: start + 7 * DAY_MS };
}

/** A semana anterior a `week`. */
const previousWeek = (week) => new Date(Date.parse(`${week}T00:00:00Z`) - 7 * DAY_MS).toISOString().slice(0, 10);

const isWeekId = (w) => typeof w === "string" && /^\d{4}-\d{2}-\d{2}$/.test(w) && new Date(`${w}T00:00:00Z`).getUTCDay() === 0;

/**
 * Valor a gravar de uma partida, ou null se não conta (marca inválida, quem não
 * chegou numa corrida). Inteiro, sempre ≥ 0.
 */
function markOf(gameId, value) {
  const g = GAME_BY_ID.get(gameId);
  if (!g || g.kind === "live") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  if (g.kind === "sum") return Math.max(0, Math.floor(n));
  if (g.dir === "asc" && n <= 0) return null; // tempo zero não existe
  return Math.round(n);
}

/** A marca nova vence a guardada? (empate não troca: quem chegou antes fica) */
function better(gameId, next, prev) {
  const g = GAME_BY_ID.get(gameId);
  if (prev == null) return true;
  return g && g.dir === "asc" ? next < prev : next > prev;
}

module.exports = {
  BRT_OFFSET_MS,
  GAMES,
  GAME_BY_ID,
  STORED,
  FIGHT_GAMES,
  weekOf,
  weekRange,
  previousWeek,
  isWeekId,
  markOf,
  better,
};
