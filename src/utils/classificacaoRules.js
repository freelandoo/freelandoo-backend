// src/utils/classificacaoRules.js
//
// A6 CLASSIFICAÇÃO (migs 395/396): as regras de QUEM VÊ, QUANDO REFAZER e do
// CONSENTIMENTO da parte psicológica. Puro, sem banco — o teste unitário roda isto.
//
// ⚠️ A parte psicológica (Big Five/IPIP) é PERFIL, não diagnóstico. Traço de
// personalidade pode ser dado sensível pela LGPD (art. 11), então:
//   • só grava com consentimento explícito da versão atual do texto;
//   • nunca aparece para outra pessoa (não há visibilidade pública dela);
//   • a pessoa apaga quando quiser, e apagar também revoga o consentimento.

const RETAKE_DAYS = 30; // refazer a prova: 1 vez a cada 30 dias (conta do início)
const ATTEMPT_MINUTES = 60; // prova aberta fecha sozinha depois disso
const DAY_MS = 24 * 60 * 60 * 1000;

// Quem vê a NOTA da prova. Ordem crescente de exposição.
const VISIBILITIES = Object.freeze(["private", "link", "profile"]);

// Versão do texto de consentimento da parte psicológica. Mudou o texto = subir aqui
// (e no front): o consentimento antigo deixa de valer para gravar.
const PERSONALITY_CONSENT_VERSION = "2026-11-08";

function normalizeVisibility(v) {
  return VISIBILITIES.includes(v) ? v : null;
}

/**
 * Se a nota pode ser mostrada por um canal:
 *   "owner"   — a própria pessoa: sempre;
 *   "link"    — quem tem o link: com `link` ou `profile`;
 *   "profile" — no perfil público: só com `profile`.
 */
function canShowScore(visibility, via) {
  if (via === "owner") return true;
  if (via === "link") return visibility === "link" || visibility === "profile";
  if (via === "profile") return visibility === "profile";
  return false;
}

/** Quando a pessoa pode começar a próxima prova (Date) — null = já pode. */
function nextAttemptAt(lastStartedAt, now = new Date()) {
  if (!lastStartedAt) return null;
  const at = new Date(new Date(lastStartedAt).getTime() + RETAKE_DAYS * DAY_MS);
  return at.getTime() > new Date(now).getTime() ? at : null;
}

/** A prova aberta passou do tempo? */
function attemptExpired(startedAt, now = new Date()) {
  return new Date(now).getTime() - new Date(startedAt).getTime() > ATTEMPT_MINUTES * 60 * 1000;
}

/**
 * O consentimento vale agora? `events` = [{ action: "grant"|"revoke", version, at }]
 * em qualquer ordem. Vale o último evento: precisa ser `grant` da versão atual.
 */
function consentActive(events, version = PERSONALITY_CONSENT_VERSION) {
  const list = (events || []).slice().sort((p, q) => new Date(p.at) - new Date(q.at));
  const last = list[list.length - 1];
  return Boolean(last && last.action === "grant" && last.version === version);
}

// ── Big Five pelo IPIP-50 (Goldberg, 1992; International Personality Item Pool,
// domínio público). Item n (1–50) → traço e sentido. Os TEXTOS ficam no front,
// nos três idiomas; aqui só a chave de correção.
const TRAITS = Object.freeze(["extraversion", "agreeableness", "conscientiousness", "stability", "openness"]);
// sentido por item, na ordem 1..50: +1 direto, −1 invertido
const IPIP50_KEYS = Object.freeze([
  1, -1, 1, -1, 1, //  1–5
  -1, 1, -1, 1, -1, //  6–10
  1, -1, 1, -1, 1, // 11–15
  -1, 1, -1, 1, -1, // 16–20
  1, -1, 1, -1, 1, // 21–25
  -1, 1, -1, -1, -1, // 26–30
  1, -1, 1, -1, 1, // 31–35
  -1, 1, -1, -1, 1, // 36–40
  1, 1, 1, -1, 1, // 41–45
  -1, 1, 1, -1, 1, // 46–50
]);
// O traço de cada item segue o ciclo E, A, C, Estabilidade, Abertura (item 1 = E).
function traitOfItem(n) {
  return TRAITS[(n - 1) % 5];
}

/**
 * Pontua o IPIP-50. `answers` = array de 50 inteiros 1–5 (1 = discordo
 * totalmente, 5 = concordo totalmente). Devolve { traits } com cada traço em
 * 0–100, ou { error }.
 *
 * Na Estabilidade os itens da escala original são de Neuroticismo (“fico
 * estressado com facilidade”); a chave já está invertida para medir ESTABILIDADE.
 */
function scorePersonality(answers) {
  if (!Array.isArray(answers) || answers.length !== IPIP50_KEYS.length) {
    return { error: "Responda as 50 afirmações." };
  }
  const sums = {};
  for (let i = 0; i < answers.length; i += 1) {
    const v = Number(answers[i]);
    if (!Number.isInteger(v) || v < 1 || v > 5) return { error: "Resposta inválida." };
    const k = traitOfItem(i + 1);
    const x = IPIP50_KEYS[i] > 0 ? v : 6 - v;
    sums[k] = (sums[k] || 0) + x;
  }
  const traits = {};
  for (const k of TRAITS) traits[k] = Math.round(((sums[k] - 10) / 40) * 100);
  return { traits };
}

module.exports = {
  RETAKE_DAYS,
  ATTEMPT_MINUTES,
  VISIBILITIES,
  PERSONALITY_CONSENT_VERSION,
  TRAITS,
  IPIP50_KEYS,
  normalizeVisibility,
  canShowScore,
  nextAttemptAt,
  attemptExpired,
  consentActive,
  traitOfItem,
  scorePersonality,
};
