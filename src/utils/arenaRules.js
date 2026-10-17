// Regras PURAS da Freelandoo Arena (módulos 04/05). Sem banco, sem rede: é o
// que dá para testar em test/unit e o que o service e o sincronizador de
// catálogo compartilham — uma régua só para "é um id válido?", "é um corpo
// aceitável?" e "esta categoria está disponível?".
//
// Os formatos ESPELHAM os schemas zod do repositório freelandoo-arena
// (`packages/contracts`): CategoryIdSchema, TeamIdSchema e PlayerIdSchema.
// Mudou um lado, muda o outro — a suíte de contrato do repositório da Arena
// valida respostas REAIS deste backend contra aqueles schemas.

const crypto = require("node:crypto");

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLAYER_ID = /^pl_[A-Za-z0-9]{10,32}$/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALES = ["pt-BR", "en", "es"];
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const isCategoryId = (v) => typeof v === "string" && v.length >= 2 && v.length <= 32 && SLUG.test(v);
const isTeamId = (v) => typeof v === "string" && v.length >= 2 && v.length <= 64 && SLUG.test(v);
const isPlayerId = (v) => typeof v === "string" && PLAYER_ID.test(v);
const isUuid = (v) => typeof v === "string" && UUID.test(v);
const isColor = (v) => v === null || v === undefined || (typeof v === "string" && COLOR.test(v));
const isRevision = (v) => Number.isInteger(v) && v >= 0 && v <= 2_147_483_647;

/**
 * playerId público: aleatório, sem relação calculável com id_user, e-mail ou
 * CPF. 20 caracteres base62 ≈ 119 bits. Rejeição por módulo para não enviesar.
 */
function newPlayerId(randomBytes = crypto.randomBytes) {
  let out = "";
  while (out.length < 20) {
    for (const b of randomBytes(32)) {
      if (b < 248) out += BASE62[b % 62];
      if (out.length === 20) break;
    }
  }
  return `pl_${out}`;
}

/**
 * Corpo de escrita: só as chaves declaradas passam. Chave a mais é recusada
 * (não ignorada) — é a trava contra atribuição em massa (`id_user`, `revision`
 * do servidor, `playerId`...).
 */
function pickBody(body, allowed) {
  if (body === undefined || body === null) return { ok: true, value: {} };
  if (typeof body !== "object" || Array.isArray(body)) return { ok: false, field: "(corpo)" };
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) return { ok: false, field: key };
  }
  return { ok: true, value: body };
}

/**
 * Disponibilidade de uma categoria para ESCOLHA. A ordem importa: a primeira
 * razão que vale é a que a tela explica.
 *   inactive         — desligada no catálogo
 *   awaiting_policy  — sensível sem política aprovada (coleta desligada)
 *   no_teams         — nenhuma equipe ativa ainda
 *   available
 */
function categoryAvailability({ isActive, isSensitive, consentPolicyVersion, activeTeamCount }) {
  if (!isActive) return "inactive";
  if (isSensitive && !(Number.isInteger(consentPolicyVersion) && consentPolicyVersion > 0)) return "awaiting_policy";
  if (!activeTeamCount) return "no_teams";
  return "available";
}

/** Rótulos traduzíveis: pt-BR obrigatório, en/es opcionais, texto curto. */
function validLabels(labels) {
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) return false;
  if (typeof labels["pt-BR"] !== "string" || !labels["pt-BR"].trim()) return false;
  for (const [k, v] of Object.entries(labels)) {
    if (!LOCALES.includes(k)) return false;
    if (typeof v !== "string" || v.length > 60) return false;
  }
  return true;
}

/**
 * Nome exibido de um jogador a partir do username da Freelandoo (público na
 * plataforma). Nunca o nome civil (`nome`): esse é dado pessoal e não precisa
 * ir para outros jogadores. Sem username, um rótulo neutro.
 */
function publicDisplayName(username) {
  const clean =
    typeof username === "string"
      ? [...username.normalize("NFKC")].filter((ch) => ch.charCodeAt(0) > 31 && ch !== "\u007f" && ch !== "<" && ch !== ">").join("").trim()
      : "";
  if (!clean) return null;
  return clean.slice(0, 40);
}

module.exports = {
  LOCALES,
  isCategoryId,
  isTeamId,
  isPlayerId,
  isUuid,
  isColor,
  isRevision,
  newPlayerId,
  pickBody,
  categoryAvailability,
  validLabels,
  publicDisplayName,
};
