// src/utils/vitrine.js
//
// Regras PURAS das vitrines A2/A4 (mig 338): quem entra em qual aba, como o
// alcance ordena e como a reserva de 30 min funciona. Sem banco aqui — os
// storages escrevem o mesmo em SQL, e o teste unitário prende as duas formas.

const { isTerritorialKind } = require("./territorialCommunity");

/**
 * Modalidades SEM membresia (ninguém "entra": pet, carro e as plataformas).
 * Nelas qualquer conta logada vê e publica nas abas, e Empregos/Dívidas mostram
 * o Brasil todo (não há "participantes" para recortar).
 */
const OPEN_KINDS = Object.freeze(["pet", "car", "games", "finance", "fitness"]);

/** Todas as modalidades que ganham as quatro abas (A4). */
const VITRINE_KINDS = Object.freeze([
  "common", "academy", "condo", "neighborhood", "pet", "car", "games", "finance", "fitness",
]);

/**
 * Como a comunidade decide quem está dentro:
 *   territorial → morador (utils/territorialCommunity)
 *   open        → qualquer conta logada
 *   member      → membro (tb_community_member) ou líder
 */
function accessModeFor(kind) {
  if (isTerritorialKind(kind)) return "territorial";
  if (OPEN_KINDS.includes(kind)) return "open";
  return "member";
}

/** As abas Empregos/Dívidas recortam pelos participantes, ou são nacionais. */
function participantScopeFor(kind) {
  return OPEN_KINDS.includes(kind) ? "national" : "participants";
}

/* ─────────────────────────── alcance (A1 / T2) ──────────────────────────── */
//
// ⚠️ O ALCANCE SÓ ORDENA, NUNCA ESCONDE (regra do Alex no A1). Quem procura
// emprego aparece para TODO mundo que abre a aba; o que muda é a ordem: mesma
// cidade → mesma área → mesma região → mesmo estado → resto do Brasil.
// A régua de lugar é `geo_tiers(perfil)` (mig 336), a mesma do feed.

function sameText(a, b) {
  return a != null && b != null && String(a) !== "" && String(a) === String(b);
}

/** 4 cidade, 3 área, 2 região, 1 estado, 0 nada em comum (ou leitor sem lugar). */
function proximityRank(viewer, cand) {
  if (!viewer || !cand) return 0;
  if (sameText(viewer.city_key, cand.city_key) && sameText(viewer.uf, cand.uf)) return 4;
  if (viewer.id_area != null && cand.id_area != null && Number(viewer.id_area) === Number(cand.id_area)) return 3;
  if (viewer.id_region != null && cand.id_region != null && Number(viewer.id_region) === Number(cand.id_region)) return 2;
  if (sameText(viewer.uf, cand.uf)) return 1;
  return 0;
}

/**
 * O mesmo `proximityRank` em SQL. `v` e `c` são aliases de linhas no formato
 * de `geo_tiers` (city_key, id_area, id_region, uf). Interpolado: só alias
 * escrito no código.
 */
function proximitySql(v, c) {
  for (const a of [v, c]) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(a)) throw new Error(`proximitySql: alias inválido: ${a}`);
  }
  return `(CASE
    WHEN ${v}.city_key IS NOT NULL AND ${v}.city_key = ${c}.city_key AND ${v}.uf = ${c}.uf THEN 4
    WHEN ${v}.id_area IS NOT NULL AND ${v}.id_area = ${c}.id_area THEN 3
    WHEN ${v}.id_region IS NOT NULL AND ${v}.id_region = ${c}.id_region THEN 2
    WHEN ${v}.uf IS NOT NULL AND ${v}.uf = ${c}.uf THEN 1
    ELSE 0 END)`;
}

/** Ordena uma lista já carregada (usado nos testes e como espelho do SQL). */
function orderByProximity(viewer, rows, tsKey = "needs_job_at") {
  return [...rows]
    .map((r) => ({ r, k: proximityRank(viewer, r.geo || r) }))
    .sort((a, b) => b.k - a.k || String(b.r[tsKey] || "").localeCompare(String(a.r[tsKey] || "")))
    .map((x) => x.r);
}

/* ─────────────────────────── boletos: reserva ───────────────────────────── */
//
// "Vou pagar" reserva o boleto por `reserve_minutes` (30). LAZY, sem job: a
// reserva vale enquanto `reserved_until > agora`; vencida, o boleto volta a
// estar livre na leitura seguinte.

function msOf(t) {
  if (t == null) return NaN;
  return t instanceof Date ? t.getTime() : Date.parse(t);
}

function isReserved(bill, now = new Date()) {
  return !!bill?.reserved_by && msOf(bill.reserved_until) > msOf(now);
}

/** null = pode reservar; senão { error, statusCode }. */
function reserveError(bill, id_user, now = new Date()) {
  if (!bill) return { error: "Boleto não encontrado.", statusCode: 404 };
  if (String(bill.id_user) === String(id_user)) {
    return { error: "Você não pode reservar o seu próprio boleto.", statusCode: 400 };
  }
  if (bill.status !== "open") return { error: "Este boleto não está mais aberto.", statusCode: 409 };
  if (isReserved(bill, now) && String(bill.reserved_by) !== String(id_user)) {
    return { error: "Alguém já está pagando este boleto. Tente de novo em alguns minutos.", statusCode: 409 };
  }
  return null;
}

/** Quem pode anexar comprovante: quem segura a reserva viva. */
function proofError(bill, id_user, now = new Date()) {
  if (!bill) return { error: "Boleto não encontrado.", statusCode: 404 };
  if (bill.status !== "open") return { error: "Este boleto não está mais aberto.", statusCode: 409 };
  if (!isReserved(bill, now) || String(bill.reserved_by) !== String(id_user)) {
    return { error: "Reserve o boleto (Vou pagar) antes de enviar o comprovante.", statusCode: 409 };
  }
  return null;
}

/* ─────────────────────────── boletos: limites ───────────────────────────── */

/**
 * Pode postar boleto? Só conta com CPF e chave "dívidas" ligada, maior de 18,
 * abaixo do teto de boletos abertos. Os números vêm de tb_debt_settings.
 */
function postError({ user, openCount, settings }) {
  if (!settings?.is_active) return { error: "O feed de boletos está pausado.", statusCode: 403 };
  if (!user?.has_cpf) {
    return { error: "Cadastre e confirme seu CPF para postar boletos.", statusCode: 403, reason: "cpf_required" };
  }
  if (user.age == null || Number(user.age) < 18) {
    return { error: "Só maiores de 18 anos podem postar boletos.", statusCode: 403, reason: "adult_only" };
  }
  if (!user.needs_debt_help) {
    return {
      error: "Ligue a chave \"Preciso pagar dívidas\" no seu perfil para postar boletos.",
      statusCode: 403,
      reason: "flag_off",
    };
  }
  if (Number(openCount) >= Number(settings.max_open)) {
    return {
      error: `Você já tem ${settings.max_open} boletos abertos. Espere um ser pago ou retire um.`,
      statusCode: 409,
      reason: "max_open",
    };
  }
  return null;
}

module.exports = {
  OPEN_KINDS,
  VITRINE_KINDS,
  accessModeFor,
  participantScopeFor,
  proximityRank,
  proximitySql,
  orderByProximity,
  isReserved,
  reserveError,
  proofError,
  postError,
};
