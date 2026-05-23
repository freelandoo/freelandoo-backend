const pool = require("../databases");
const StoreProhibitedRuleStorage = require("../storages/StoreProhibitedRuleStorage");
const { createLogger } = require("../utils/logger");

const log = createLogger("StoreProductPolicyService");

// ─── Normalização (versão simplificada — sem leet, sem rate-limit) ──────────
function stripDiacritics(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function removeInvisible(s) {
  // eslint-disable-next-line no-irregular-whitespace -- chars zero-width intencionais (zero-width space → soft hyphen) no regex
  return s.replace(/[​-‍﻿­]/g, "");
}
function normalize(text) {
  if (!text) return "";
  let s = String(text);
  s = removeInvisible(s);
  s = s.normalize("NFKC");
  s = stripDiacritics(s);
  s = s.toLowerCase();
  s = s.replace(/(.)\1{2,}/g, "$1$1");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function termMatches(rule, originalLower, normalizedText) {
  try {
    if (rule.rule_type === "regex") {
      const re = new RegExp(rule.normalized_term || rule.term || "", "i");
      return re.test(originalLower) || re.test(normalizedText);
    }
    const needle = rule.normalized_term || normalize(rule.term || "");
    if (!needle) return false;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
    return re.test(normalizedText) || re.test(originalLower);
  } catch (err) {
    log.warn("rule.regex_fail", { id: rule.id_rule, message: err.message });
    return false;
  }
}

const ACTION_PRIORITY = {
  allow: 0,
  review: 1,
  hide_product: 2,
  block: 3,
  ban_product: 4,
  ban_category: 5,
};

// Cache 5min de regras ativas
let RULES_CACHE = { fetched_at: 0, rules: [] };
const RULES_TTL_MS = 5 * 60 * 1000;

async function getActiveRules() {
  const now = Date.now();
  if (now - RULES_CACHE.fetched_at < RULES_TTL_MS && RULES_CACHE.rules.length > 0) {
    return RULES_CACHE.rules;
  }
  try {
    const rules = await StoreProhibitedRuleStorage.listActive(pool);
    RULES_CACHE = { fetched_at: now, rules };
    return rules;
  } catch (err) {
    log.error("rules.load_fail", { message: err.message });
    return RULES_CACHE.rules;
  }
}

function invalidateCache() {
  RULES_CACHE = { fetched_at: 0, rules: [] };
}

/**
 * Avalia produto/pedido contra as regras ativas.
 * input: { title, description, id_product_category }
 * Retorna: { action, severity, matched, reason } onde
 *   action ∈ allow | review | block | ban_product | hide_product | ban_category.
 */
async function checkAgainstRules({ title, description, id_product_category }) {
  const rules = await getActiveRules();

  // 1) manual_allow tem precedência total — se algum casar exatamente o título,
  //    libera produto independente das outras regras.
  const titleNorm = normalize(title);
  const descNorm = normalize(description);
  const fullNorm = `${titleNorm} ${descNorm}`.trim();
  const fullLower = `${String(title || "").toLowerCase()} ${String(description || "").toLowerCase()}`.trim();

  for (const r of rules) {
    if (r.rule_type === "manual_allow" && termMatches(r, fullLower, fullNorm)) {
      return { action: "allow", severity: "low", matched: [r], reason: "Liberação manual explícita" };
    }
  }

  const matched = [];

  // 2) categoria proibida (ban_category ou regra type='category')
  if (id_product_category) {
    for (const r of rules) {
      if (
        (r.rule_type === "category" || r.action === "ban_category") &&
        Number(r.id_product_category) === Number(id_product_category)
      ) {
        matched.push(r);
      }
    }
  }

  // 3) termos/regex/marca/nome
  for (const r of rules) {
    if (["term", "regex", "brand", "product_name"].includes(r.rule_type)) {
      if (termMatches(r, fullLower, fullNorm)) matched.push(r);
    }
  }

  if (matched.length === 0) {
    return { action: "allow", severity: "low", matched: [], reason: null };
  }

  // Escolhe a ação mais severa
  matched.sort((a, b) => (ACTION_PRIORITY[b.action] || 0) - (ACTION_PRIORITY[a.action] || 0));
  const top = matched[0];
  return {
    action: top.action,
    severity: top.severity,
    matched,
    reason: top.reason || "Regra de loja acionada",
  };
}

function decisionToProductStatus(decision) {
  switch (decision) {
    case "allow":         return "active";
    case "review":        return "pending_review";
    case "hide_product":  return "blocked";
    case "block":         return "blocked";
    case "ban_product":   return "banned";
    case "ban_category":  return "blocked";
    default:              return "active";
  }
}

class StoreProductPolicyService {
  static normalize = normalize;
  static invalidateCache = invalidateCache;
  static decisionToProductStatus = decisionToProductStatus;

  static async checkProduct({ title, description, id_product_category }) {
    const r = await checkAgainstRules({ title, description, id_product_category });
    return { ...r, moderation_status: decisionToProductStatus(r.action) };
  }

  static async checkProductRequest({ title, description, id_product_category }) {
    const r = await checkAgainstRules({ title, description, id_product_category });
    return { ...r, moderation_status: decisionToProductStatus(r.action) };
  }
}

module.exports = StoreProductPolicyService;
