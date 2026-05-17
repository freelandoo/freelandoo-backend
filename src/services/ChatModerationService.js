const leoProfanity = require("leo-profanity");
const pool = require("../databases");
const ChatModerationStorage = require("../storages/ChatModerationStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ChatModerationService");

// ─── leo-profanity baseline (EN). PT-BR vem da nossa tabela. ─────────────────
try {
  leoProfanity.loadDictionary("en");
} catch (err) {
  log.warn("leo.load_fail", { message: err.message });
}

// Cache local de blocked_terms (recarregado a cada 5 min e quando admin muda)
let TERMS_CACHE = { fetched_at: 0, terms: [] };
const TERMS_TTL_MS = 5 * 60 * 1000;

async function getActiveTerms() {
  const now = Date.now();
  if (now - TERMS_CACHE.fetched_at < TERMS_TTL_MS && TERMS_CACHE.terms.length > 0) {
    return TERMS_CACHE.terms;
  }
  try {
    const terms = await ChatModerationStorage.listActiveTerms(pool);
    TERMS_CACHE = { fetched_at: now, terms };
    // Reflete na lib pra `leoProfanity.check` cobrir nossos termos PT-BR também.
    leoProfanity.clearList();
    leoProfanity.loadDictionary("en");
    const plainPtTerms = terms
      .filter((t) => !t.is_regex)
      .map((t) => t.normalized_term);
    if (plainPtTerms.length > 0) {
      leoProfanity.add(plainPtTerms);
    }
    return terms;
  } catch (err) {
    log.error("terms.load_fail", { message: err.message });
    return TERMS_CACHE.terms;
  }
}

function invalidateTermsCache() {
  TERMS_CACHE = { fetched_at: 0, terms: [] };
}

// Rate-limit em memória (process-scoped) — sem Redis. Window deslizante.
const RATE_BUCKETS = new Map(); // id_user → [{ ts, content_hash }]
const RATE_BUCKET_TTL_MS = 60 * 1000; // keep só último minuto

function pushBucket(id_user, content_hash) {
  const now = Date.now();
  const arr = RATE_BUCKETS.get(id_user) || [];
  const filtered = arr.filter((e) => now - e.ts < RATE_BUCKET_TTL_MS);
  filtered.push({ ts: now, content_hash });
  RATE_BUCKETS.set(id_user, filtered);
  return filtered;
}

function countInWindow(id_user, windowSec) {
  const now = Date.now();
  const cutoff = now - windowSec * 1000;
  const arr = RATE_BUCKETS.get(id_user) || [];
  return arr.filter((e) => e.ts >= cutoff).length;
}

function lastBucketHash(id_user) {
  const arr = RATE_BUCKETS.get(id_user) || [];
  return arr.length ? arr[arr.length - 1].content_hash : null;
}

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

// ─── 1) Normalização ────────────────────────────────────────────────────────
const LEET_MAP = {
  "@": "a", "4": "a", "8": "b", "(": "c", "3": "e",
  "1": "i", "!": "i", "|": "i", "0": "o", "5": "s",
  "$": "s", "7": "t", "+": "t", "2": "z",
};

function stripDiacritics(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function applyLeet(s) {
  return s.split("").map((ch) => LEET_MAP[ch] || ch).join("");
}

function removeInvisible(s) {
  // remove zero-width chars (U+200B..U+200D), BOM (U+FEFF), soft hyphen (U+00AD)
  return s.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");
}

function normalizeText(text) {
  if (!text) return "";
  let s = String(text);
  s = removeInvisible(s);
  s = s.normalize("NFKC");
  s = stripDiacritics(s);
  s = s.toLowerCase();
  s = applyLeet(s);
  // colapsa repetidos: "ch444aaaammaa" → "chama" (limita 2 chars repetidos)
  s = s.replace(/(.)\1{2,}/g, "$1$1");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// ─── 2) Detecção em texto (original + normalizado) ──────────────────────────
function termMatches(term, originalText, normalizedText) {
  try {
    if (term.is_regex) {
      const re = new RegExp(term.normalized_term, "i");
      return re.test(originalText) || re.test(normalizedText);
    }
    const needle = term.normalized_term;
    if (!needle) return false;
    // matches "palavra inteira" no normalizado (boundary baseada em não-letra/dígito)
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
    return re.test(normalizedText) || re.test(originalText.toLowerCase());
  } catch (err) {
    log.warn("term.regex_fail", { id: term.id_blocked_term, message: err.message });
    return false;
  }
}

async function checkCustomBlockedTerms(originalText, normalizedText) {
  const terms = await getActiveTerms();
  const matches = [];
  for (const t of terms) {
    if (termMatches(t, originalText, normalizedText)) {
      matches.push({
        id_blocked_term: t.id_blocked_term,
        term: t.term,
        category: t.category,
        severity: t.severity,
        action: t.action,
      });
    }
  }
  return matches;
}

function checkProfanityLib(normalizedText) {
  try {
    return !!leoProfanity.check(normalizedText);
  } catch {
    return false;
  }
}

// ─── 3) Links ────────────────────────────────────────────────────────────────
const URL_RE = /\b((?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+(?:com|com\.br|net|org|io|me|app|co|gg|live|xyz|click|tk|ru)(?:\/\S*)?)/gi;
const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "is.gd", "ow.ly", "shorturl.at", "encurtador.com.br"];

function checkLinks(originalText) {
  const matches = [];
  const found = originalText.match(URL_RE) || [];
  for (const url of found) {
    const lower = url.toLowerCase();
    const suspicious = SHORTENERS.some((s) => lower.includes(s));
    matches.push({ url, suspicious });
  }
  return matches;
}

// ─── 4) Spam / flood ────────────────────────────────────────────────────────
function checkSpam(id_user, normalizedText, settings) {
  const flags = [];
  let scoreDelta = 0;
  const windowSec = settings.window_seconds || 10;
  const maxInWindow = settings.max_messages_per_window || 5;

  const recentCount = countInWindow(id_user, windowSec);
  if (recentCount >= maxInWindow) {
    flags.push("flood");
    scoreDelta += 40;
  }

  const hash = djb2(normalizedText);
  if (lastBucketHash(id_user) === hash) {
    flags.push("duplicate");
    scoreDelta += 25;
  }

  // excesso de caixa alta (>=60% das letras + msg >=20 chars)
  const letters = normalizedText.match(/[a-z]/g) || [];
  if (letters.length >= 20) {
    const original = normalizedText; // ja lowercase
    // como já está em lowercase, comparamos contra a string original via flag externa
    // (omito caps detection robusta pra MVP — flag opcional)
    if (original === original.toUpperCase() && original !== original.toLowerCase()) {
      flags.push("all_caps");
      scoreDelta += 10;
    }
  }

  return { flags, scoreDelta, recentCount, hash };
}

// ─── 5) Risk score + decisão ────────────────────────────────────────────────
const SEVERITY_SCORES = { low: 15, medium: 30, high: 60, critical: 80 };
const CATEGORY_BOOSTS = {
  sexual: 20,
  drugs: 30,
  weapons: 30,
  fraud: 40,
  platform_evasion: 10,
  suspicious_links: 30,
  hate: 50,
  harassment: 25,
  minors_safety: 100,
  personal_data: 20,
  forbidden_services: 30,
  forbidden_products: 30,
};

function calculateRiskScore(matched_terms, link_matches, spamScore, profanityLibHit) {
  let score = 0;
  for (const m of matched_terms) {
    score += SEVERITY_SCORES[m.severity] || 15;
    score += CATEGORY_BOOSTS[m.category] || 0;
  }
  if (profanityLibHit && matched_terms.length === 0) score += 20;
  for (const lk of link_matches) {
    score += lk.suspicious ? 40 : 10;
  }
  score += spamScore;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function decideAction(score, matched_terms, thresholds) {
  // Se algum match tem action explícita "block" ou mais grave, prevalece.
  const PRIO = { allow: 0, warn: 1, mask: 2, review: 3, mute_temp: 4, ban_temp: 5, block: 6 };
  let explicit = null;
  for (const m of matched_terms) {
    if (!explicit || (PRIO[m.action] || 0) > (PRIO[explicit] || 0)) explicit = m.action;
  }
  let byScore;
  const t = thresholds || { mask: 21, review: 41, block: 61, mute: 81 };
  if (score >= (t.mute || 81)) byScore = "mute_temp";
  else if (score >= (t.block || 61)) byScore = "block";
  else if (score >= (t.review || 41)) byScore = "review";
  else if (score >= (t.mask || 21)) byScore = "mask";
  else byScore = "allow";

  if (explicit && (PRIO[explicit] || 0) > (PRIO[byScore] || 0)) return explicit;
  return byScore;
}

// ─── 6) Aplicação da máscara ────────────────────────────────────────────────
function applyMask(originalText, matched_terms) {
  let masked = originalText;
  for (const m of matched_terms) {
    if (!m.term) continue;
    const escaped = m.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    masked = masked.replace(re, (matched) => "*".repeat(matched.length));
  }
  return masked;
}

// ─── 7) moderateMessage — orquestra tudo ────────────────────────────────────
class ChatModerationService {
  static get HOLDBACK_FLAGS() { return ["flood", "duplicate", "empty", "too_long", "muted", "banned"]; }

  static invalidateTermsCache() {
    invalidateTermsCache();
  }

  static async getEffectiveUserState(id_user) {
    const state = await ChatModerationStorage.getUserState(pool, id_user);
    if (!state) return { muted: false, banned: false };
    const now = Date.now();
    return {
      muted: state.public_chat_muted_until && new Date(state.public_chat_muted_until).getTime() > now,
      banned: state.public_chat_banned_until && new Date(state.public_chat_banned_until).getTime() > now,
      muted_until: state.public_chat_muted_until,
      banned_until: state.public_chat_banned_until,
      warning_count: state.warning_count || 0,
    };
  }

  /**
   * Resultado:
   *   {
   *     action,
   *     risk_score,
   *     flags,
   *     matched_terms,
   *     reason,
   *     original_text,
   *     normalized_text,
   *     masked_content?,
   *     user_facing_error?,
   *     mute_minutes?,
   *   }
   */
  static async moderateMessage({ id_user, room_type, original_text }) {
    return runWithLogs(log, "moderateMessage", () => ({ id_user, room_type }), async () => {
      const settings = (await ChatModerationStorage.getSettings(pool, room_type)) || {};
      const maxLen = settings.max_message_length || 500;
      const thresholds = settings.score_thresholds || { mask: 21, review: 41, block: 61, mute: 81 };
      const muteMinutes = settings.mute_temp_minutes || 10;

      // estado do user — banido/mutado curto-circuita
      const state = await ChatModerationService.getEffectiveUserState(id_user);
      if (state.banned) {
        return {
          action: "block", risk_score: 100, flags: ["banned"], matched_terms: [],
          original_text, normalized_text: "",
          reason: "Usuário banido temporariamente do chat público",
          user_facing_error: "Você está banido do chat público.",
        };
      }
      if (state.muted) {
        return {
          action: "block", risk_score: 100, flags: ["muted"], matched_terms: [],
          original_text, normalized_text: "",
          reason: "Usuário silenciado",
          user_facing_error: "Você está silenciado temporariamente. Aguarde alguns minutos.",
        };
      }

      // Validações básicas
      const raw = String(original_text || "").trim();
      if (!raw) {
        return { action: "block", risk_score: 0, flags: ["empty"], matched_terms: [], original_text: "", normalized_text: "", reason: "Mensagem vazia", user_facing_error: "Mensagem vazia." };
      }
      if (raw.length > maxLen) {
        return { action: "block", risk_score: 100, flags: ["too_long"], matched_terms: [], original_text: raw, normalized_text: "", reason: `Mensagem maior que ${maxLen} caracteres`, user_facing_error: `Mensagem muito longa (limite ${maxLen}).` };
      }

      const normalized = normalizeText(raw);

      // Mensagem só com emoji é permitida (sem texto normalizável)
      // Se normalized vazio (só símbolos/emoji), pula checks de term/profanity.
      const onlyEmoji = normalized.length === 0;

      // Spam / flood
      const spam = checkSpam(id_user, normalized || raw, settings);
      if (spam.flags.includes("flood")) {
        // não passa: mensagem rápida demais
        return {
          action: "block",
          risk_score: 100,
          flags: spam.flags,
          matched_terms: [],
          original_text: raw,
          normalized_text: normalized,
          reason: "Flood — muitas mensagens em sequência",
          user_facing_error: "Você está enviando mensagens rápido demais. Aguarde alguns segundos.",
        };
      }

      // Termos próprios + lib (skip se só emoji)
      const matched_terms = onlyEmoji ? [] : await checkCustomBlockedTerms(raw, normalized);
      const profanityLibHit = onlyEmoji ? false : checkProfanityLib(normalized);

      // Links
      const link_matches = checkLinks(raw);
      const flags = [...spam.flags];
      if (profanityLibHit && matched_terms.length === 0) flags.push("profanity_lib");
      if (link_matches.length) flags.push(link_matches.some((l) => l.suspicious) ? "suspicious_link" : "link");

      const risk_score = calculateRiskScore(matched_terms, link_matches, spam.scoreDelta, profanityLibHit);
      const action = decideAction(risk_score, matched_terms, thresholds);

      let masked_content = null;
      let user_facing_error = null;
      if (action === "mask") {
        masked_content = applyMask(raw, matched_terms);
      } else if (action === "block") {
        user_facing_error = "Sua mensagem foi bloqueada por violar nossas regras.";
      } else if (action === "mute_temp") {
        user_facing_error = `Conteúdo grave detectado. Você está silenciado por ${muteMinutes} min.`;
      }

      // grava no rate bucket SE não bloqueado por flood/empty
      pushBucket(id_user, spam.hash);

      return {
        action,
        risk_score,
        flags,
        matched_terms,
        original_text: raw,
        normalized_text: normalized,
        reason: matched_terms.map((m) => m.term).join(", ") || (flags.join(",") || null),
        masked_content,
        user_facing_error,
        mute_minutes: muteMinutes,
      };
    });
  }

  /** Aplica side-effects: log no DB + mute_temp se necessário. */
  static async applyResult({ moderation, id_user, id_chat_room, id_chat_message }) {
    const reviewStatus = moderation.action === "review" ? "pending" : "none";
    await ChatModerationStorage.insertResult(pool, {
      id_chat_message: id_chat_message || null,
      id_chat_room: id_chat_room || null,
      id_user,
      original_text: moderation.original_text,
      normalized_text: moderation.normalized_text,
      action: moderation.action,
      risk_score: moderation.risk_score,
      flags: moderation.flags,
      matched_terms: moderation.matched_terms,
      reason: moderation.reason,
      review_status: reviewStatus,
    });
    if (moderation.action === "mute_temp") {
      await ChatModerationStorage.muteUser(
        pool, id_user, moderation.mute_minutes || 10,
        moderation.reason || "auto"
      );
    }
  }

  /**
   * Pós-denúncia: chamado quando alguém reporta uma mensagem.
   * Se contagem >= auto_hide_threshold → esconde mensagem.
   * Se contagem >= review_threshold → marca pra revisão.
   */
  static async onMessageReported({ id_chat_message }) {
    return runWithLogs(log, "onMessageReported", () => ({ id_chat_message }), async () => {
      const message = await ChatModerationStorage.getMessageById(pool, id_chat_message);
      if (!message) return { error: "not_found" };
      if (message.hidden_at) return { already_hidden: true };
      const settings = (await ChatModerationStorage.getSettings(pool, message.room_type)) || {};
      const hideThreshold = settings.auto_hide_report_threshold || 3;
      const reviewThreshold = settings.review_report_threshold || 5;

      const count = await ChatModerationStorage.countReports(pool, id_chat_message);
      if (count >= hideThreshold) {
        await ChatModerationStorage.hideMessage(pool, id_chat_message, "reports");
        await ChatModerationStorage.insertResult(pool, {
          id_chat_message,
          id_chat_room: message.id_chat_room,
          id_user: message.id_user,
          original_text: message.content,
          normalized_text: normalizeText(message.content),
          action: "hide",
          risk_score: 50 + Math.min(50, count * 5),
          flags: ["reports"],
          matched_terms: [],
          reason: `${count} denúncias`,
          review_status: count >= reviewThreshold ? "pending" : "none",
        });
      }
      return { reports: count };
    });
  }

  // Helpers expostos pra testes/admin
  static get _internals() {
    return {
      normalizeText, checkCustomBlockedTerms, checkLinks, checkSpam,
      calculateRiskScore, decideAction, applyMask, getActiveTerms,
    };
  }
}

module.exports = ChatModerationService;
module.exports.normalizeText = normalizeText;
