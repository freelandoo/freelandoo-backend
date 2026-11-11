// src/utils/meuMundoStatue.js — MEU MUNDO 3D, lore v2 N3: DOMINGO NA ESTÁTUA.
//
// O néctar ganho na semana (N2, carteira "para entregar") só é entregue no
// DOMINGO, o dia todo, no relógio de Brasília (UTC−3 fixo, o mesmo do placar),
// na estátua do PRÓPRIO deus:
//   Raposa  → Aurion, no meio do bairro dela (visit:estatua_aurion)
//   Vampiro → Morkhan, na praça do centro (visit:estatua_morkhan)
// A Cidade Baixa só tem o pedestal vazio (C1): lá não há ponto de visita.
// O SERVIDOR confere o lugar pela última visita gravada pela sala (F4).
//
// A CORRIDA: cada domingo, cada povo enche a sua estátua. A meta (decisão D4)
// se ajusta aos jogadores ATIVOS daquele povo (quem ganhou néctar na semana
// que acabou de fechar): max(base, ativos × por ativo), com os dois números no
// admin. A meta congela na primeira entrega do domingo. Estágios da estátua:
// 0 dormindo · 1 racha (25%) · 2 pedaços soltos (50%) · 3 olhos acesos (75%)
// · 4 CHEIA (100% — grava `full_at`; a N4 solta o deus na semana seguinte).
"use strict";

const S = require("./meuMundoScores");

const DAY_MS = 24 * 3600 * 1000;
/** Onde cada povo entrega (o id do ponto de visita). */
const PLACE_OF = Object.freeze({ raposa: "estatua_aurion", vampiro: "estatua_morkhan" });
/** O deus de cada povo (para a tela e a cena). */
const GOD_OF = Object.freeze({ raposa: "aurion", vampiro: "morkhan" });
const CLANS = Object.freeze(["raposa", "vampiro"]);
/** A última visita à estátua vale por isto (a sala regrava a cada minuto parado). */
const PLACE_TTL_MS = 10 * 60 * 1000;
/** Padrão da meta (mL) — o admin troca (tb_mm_statue_config). */
const DEFAULT_CONFIG = Object.freeze({ baseMl: 30000, perActiveMl: 6000 });
/** Limites do que o admin pode gravar (mL). */
const CONFIG_MAX_ML = 100000000;
/** Fração da meta em que cada estágio começa. */
const STAGES = Object.freeze([
  Object.freeze({ stage: 0, at: 0, id: "dormindo" }),
  Object.freeze({ stage: 1, at: 0.25, id: "racha" }),
  Object.freeze({ stage: 2, at: 0.5, id: "pedacos" }),
  Object.freeze({ stage: 3, at: 0.75, id: "olhos" }),
  Object.freeze({ stage: 4, at: 1, id: "cheia" }),
]);

/** É domingo em Brasília em `now`? */
function isSunday(now) {
  const week = S.weekOf(now);
  return Number(now) < S.weekRange(week).start + DAY_MS;
}

/** O domingo da corrida de `now` (o id da semana que começou nele). */
const raceWeek = (now) => S.weekOf(now);

/** Quando abre o próximo domingo (ms). Se já é domingo, o começo de hoje. */
function nextSundayAt(now) {
  const week = S.weekOf(now);
  return isSunday(now) ? S.weekRange(week).start : S.weekRange(week).end;
}

/** Quando o domingo de `week` termina (ms). */
const sundayEndsAt = (week) => S.weekRange(week).start + DAY_MS;

/** Meta (mL) para `active` jogadores com a config `{ baseMl, perActiveMl }`. */
function goalFor(active, cfg = DEFAULT_CONFIG) {
  const base = Math.max(1, Math.floor(Number(cfg.baseMl) || DEFAULT_CONFIG.baseMl));
  const per = Math.max(0, Math.floor(Number(cfg.perActiveMl) || 0));
  const n = Math.max(0, Math.floor(Number(active) || 0));
  return Math.max(base, n * per);
}

/** Estágio (0–4) de uma estátua com `delivered` de `goal` mL. */
function stageOf(delivered, goal) {
  const g = Number(goal) || 0;
  if (g <= 0) return 0;
  const f = Math.max(0, Number(delivered) || 0) / g;
  let s = 0;
  for (const st of STAGES) if (f >= st.at) s = st.stage;
  return s;
}

/** A pessoa pode entregar ali? `last` = { place, at } da última visita. */
function placeOk(clan, last, now) {
  const want = PLACE_OF[clan];
  if (!want || !last || last.place !== want) return false;
  return Number(now) - new Date(last.at).getTime() <= PLACE_TTL_MS;
}

/** Valida e normaliza a config que vem do admin (em LITROS na tela → mL). */
function parseConfig(body = {}) {
  const baseL = Number(body.baseL);
  const perL = Number(body.perActiveL);
  if (!Number.isFinite(baseL) || !Number.isFinite(perL)) return null;
  const baseMl = Math.round(baseL * 1000);
  const perActiveMl = Math.round(perL * 1000);
  if (baseMl < 1000 || baseMl > CONFIG_MAX_ML || perActiveMl < 0 || perActiveMl > CONFIG_MAX_ML) return null;
  return { baseMl, perActiveMl };
}

/** Chave do pedido de entrega (idempotência): letras, números, - e _. */
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

module.exports = {
  PLACE_OF,
  GOD_OF,
  CLANS,
  PLACE_TTL_MS,
  DEFAULT_CONFIG,
  STAGES,
  KEY_RE,
  isSunday,
  raceWeek,
  nextSundayAt,
  sundayEndsAt,
  goalFor,
  stageOf,
  placeOk,
  parseConfig,
};
