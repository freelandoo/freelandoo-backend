// src/utils/whatsappCloudQuality.js
// W6 — lê os eventos de QUALIDADE do webhook da Cloud API.
//
// ─── POR QUE ISTO É FUNÇÃO PURA ─────────────────────────────────────────────
//
// A decisão que mora aqui é "isto merece acordar o dono do número?", e ela é
// pura: entra o corpo que a Meta mandou, sai um veredito. Testável sem banco,
// sem rede e sem webhook — que é o único jeito de exercitar um evento como
// `ACCOUNT_VIOLATION`, que ninguém consegue provocar sob demanda.
//
// ─── O QUE CADA CAMPO DA META TRAZ (e o que ele NÃO traz) ───────────────────
//
// `phone_number_quality_update`:
//   { display_phone_number, event: FLAGGED|UNFLAGGED|ONBOARDING|DOWNGRADE|UPGRADE,
//     current_limit: "TIER_1K" }
//
// ⚠️ ELE NÃO TRAZ `quality_rating`. Não há GREEN/YELLOW/RED no payload — só o
// EVENTO. Derivar o rating a partir dele seria inventar um dado e gravá-lo num
// campo que o painel apresenta como medido; quem for calibrar depois confia
// nele. O rating de verdade vem do GET do número (`provider.state`), que o
// `WhatsappService.status` já faz a cada abertura da aba — e é lá que ele é
// gravado. **Cada fonte grava só o que ela realmente sabe.**
//
// `account_update`:
//   { phone_number, event, ban_info?, restriction_info?, violation_info? }
//
// ─── O ROTEAMENTO AQUI É POR NÚMERO, NÃO POR `phone_number_id` ──────────────
//
// Diferente de `messages`, estes dois campos NÃO trazem
// `value.metadata.phone_number_id` — trazem o número em texto. Por isso o
// parser devolve dígitos puros: `+55 11 96812-8174`, `5511968128174` e
// `55 11 96812 8174` são o mesmo número, e casar string crua erraria por causa
// de um hífen.

/** Só os dígitos. `null` vira "" — nunca "null" dentro de um WHERE. */
function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * Eventos que merecem acordar o dono.
 *
 * ⚠️ Boa notícia NÃO avisa. `UPGRADE`, `UNFLAGGED` e `ONBOARDING` são gravados
 * (o painel precisa deles) e não notificam: aviso que chega quando não há nada
 * a fazer é o que ensina a pessoa a ignorar o próximo, que é o que importa.
 */
const ALERT_QUALITY_EVENTS = new Set(["FLAGGED", "DOWNGRADE"]);

/**
 * Do lado da CONTA, o que é apuro de verdade. `VERIFIED_ACCOUNT` e
 * `PHONE_NUMBER_ADDED` passam por aqui o tempo todo e não são problema de
 * ninguém.
 */
const ALERT_ACCOUNT_EVENTS = new Set([
  "ACCOUNT_VIOLATION",
  "ACCOUNT_RESTRICTION",
  "ACCOUNT_DELETED",
  "DISABLED_UPDATE",
  "ACCOUNT_BANNED",
]);

/**
 * O evento de qualidade também diz em que STATUS o número ficou — e este, sim,
 * o payload afirma. `FLAGGED` é o status da Graph API com o mesmo nome;
 * `UNFLAGGED` devolve o número a `CONNECTED`.
 *
 * Evento que não fala de status devolve `null`, e `null` NÃO sobrescreve o que
 * está gravado: apagar o status conhecido por causa de um `UPGRADE` deixaria o
 * painel mais pobre depois de uma boa notícia.
 */
function statusFromQualityEvent(event) {
  if (event === "FLAGGED") return "FLAGGED";
  if (event === "UNFLAGGED") return "CONNECTED";
  return null;
}

function statusFromAccountEvent(event, value) {
  if (event === "ACCOUNT_RESTRICTION") return "RESTRICTED";
  if (event === "ACCOUNT_BANNED" || event === "ACCOUNT_DELETED") return "BANNED";
  // `ban_info` presente é mais confiável que o nome do evento: a Meta mudou a
  // nomenclatura dele mais de uma vez, e o objeto só aparece quando há ban.
  if (value && value.ban_info) return "BANNED";
  if (value && Array.isArray(value.restriction_info) && value.restriction_info.length) {
    return "RESTRICTED";
  }
  return null;
}

/**
 * Lê um bloco do envelope. Devolve `null` para tudo que não for evento de
 * qualidade — quem chama trata isso como "não é comigo", nunca como erro.
 */
function readQualityEvent(block) {
  const field = String((block && block.field) ?? "").trim();
  const value = (block && block.value) || {};

  if (field === "phone_number_quality_update") {
    const event = upper(value.event);
    return {
      kind: "quality",
      field,
      // `display_phone_number` é o nome documentado; `phone_number` aparece em
      // payloads antigos. Aceitar os dois custa uma linha e evita um evento
      // ignorado em silêncio.
      phone: onlyDigits(value.display_phone_number ?? value.phone_number),
      event,
      rating: null, // ⚠️ a Meta não manda rating aqui — ver o cabeçalho.
      status: statusFromQualityEvent(event),
      limit: upper(value.current_limit) || null,
      alert: ALERT_QUALITY_EVENTS.has(event),
    };
  }

  if (field === "account_update") {
    const event = upper(value.event);
    return {
      kind: "account",
      field,
      phone: onlyDigits(value.phone_number ?? value.display_phone_number),
      event,
      rating: null,
      status: statusFromAccountEvent(event, value),
      limit: null,
      // Ban e restrição avisam mesmo com nome de evento desconhecido: o objeto
      // no corpo vale mais que o rótulo.
      alert:
        ALERT_ACCOUNT_EVENTS.has(event) ||
        !!(value && value.ban_info) ||
        !!(value && Array.isArray(value.restriction_info) && value.restriction_info.length),
    };
  }

  return null;
}

module.exports = {
  readQualityEvent,
  statusFromQualityEvent,
  statusFromAccountEvent,
  ALERT_QUALITY_EVENTS,
  ALERT_ACCOUNT_EVENTS,
};
