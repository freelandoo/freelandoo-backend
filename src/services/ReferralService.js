const ReferralStorage = require("../storages/ReferralStorage");
const AffiliateStorage = require("../storages/AffiliateStorage");
const AffiliateProgramStorage = require("../storages/AffiliateProgramStorage");
const { createLogger } = require("../utils/logger");

const log = createLogger("ReferralService");

/**
 * Vínculo vitalício de indicação (mig 193).
 *
 * Regra de hierarquia (decisão do Alex, 2026-08-05):
 *   • PLATAFORMA vende (perfil, poléns, premium, manifestação, boost, Loja de
 *     Funções) → usar o cupom cria o vínculo, que passa a valer para sempre e
 *     VENCE qualquer cupom de terceiro.
 *   • USUÁRIO vende (produto, curso, serviço, booking) → NÃO cria vínculo; lá o
 *     cupom de quem compartilhou o conteúdo é que leva a comissão.
 *
 * Este service nunca derruba um checkout: falha vira log.
 */

/** Contextos em que o vínculo pode nascer. Fonte da verdade: tabela de regras. */
async function isPlatformContext(conn, source_context) {
  if (!source_context) return true; // checkout legado de ativação = plataforma
  try {
    const rule = await AffiliateProgramStorage.getRule(conn, source_context);
    if (!rule) return false;
    return rule.regime === "platform" && rule.creates_bond === true;
  } catch (err) {
    log.warn("referral.rule_lookup_fail", { source_context, message: err.message });
    return false;
  }
}

/**
 * Cria o vínculo se ele ainda não existir. Idempotente e silencioso.
 *
 * Travas (todas obrigatórias):
 *   • não vincula a si mesmo;
 *   • não vincula se o CPF do indicado for igual ao do afiliado — mata "compro
 *     com meu segundo cadastro" (só possível desde a mig 188);
 *   • afiliado precisa estar ACTIVE;
 *   • vínculo existente NUNCA é sobrescrito (UNIQUE + ON CONFLICT DO NOTHING).
 *
 * @returns {Promise<Object|null>} o vínculo (novo ou o que já existia), ou null.
 */
async function bind(conn, {
  id_user_buyer,
  id_affiliate,
  id_coupon = null,
  id_order = null,
  source_context = null,
  bound_source = "first_purchase",
}) {
  try {
    if (!id_user_buyer || !id_affiliate) return null;

    // Vínculo só nasce quando é a plataforma vendendo.
    if (bound_source !== "admin" && !(await isPlatformContext(conn, source_context))) {
      return null;
    }

    const existing = await ReferralStorage.getAnyByUser(conn, id_user_buyer);
    if (existing) return existing; // primeiro vínculo vence, para sempre

    const affiliate = await AffiliateStorage.getAffiliateById(conn, id_affiliate);
    if (!affiliate || affiliate.status !== "ACTIVE") return null;

    if (String(affiliate.id_user) === String(id_user_buyer)) {
      log.info("referral.skip.self", { id_user_buyer });
      return null;
    }

    // Mesma pessoa em duas contas (mig 188): CPF é do titular, então CPF igual
    // significa auto-indicação disfarçada.
    const [buyerCpf, affiliateCpf] = await Promise.all([
      ReferralStorage.getUserCpf(conn, id_user_buyer),
      ReferralStorage.getUserCpf(conn, affiliate.id_user),
    ]);
    if (buyerCpf && affiliateCpf && buyerCpf === affiliateCpf) {
      log.warn("referral.skip.same_cpf", { id_user_buyer, id_affiliate });
      return null;
    }

    const created = await ReferralStorage.create(conn, {
      id_user_referred: id_user_buyer,
      id_affiliate,
      id_coupon,
      bound_source,
      id_first_order: id_order,
    });

    if (created) {
      log.info("referral.bound", {
        id_referral: created.id_referral,
        id_user_buyer,
        id_affiliate,
        source_context,
      });
      return created;
    }

    // Corrida: outro webhook criou entre o SELECT e o INSERT — o dele vence.
    return await ReferralStorage.getAnyByUser(conn, id_user_buyer);
  } catch (err) {
    log.error("referral.bind.fail", { message: err.message, id_user_buyer });
    return null;
  }
}

/** Vínculo vivo do comprador, ou null. Nunca lança. */
async function resolve(conn, id_user) {
  try {
    if (!id_user) return null;
    return await ReferralStorage.getActiveByUser(conn, id_user);
  } catch (err) {
    log.error("referral.resolve.fail", { message: err.message, id_user });
    return null;
  }
}

/** Quebra do vínculo pelo admin (fraude/disputa). Não apaga o histórico. */
async function release(conn, { id_referral, reason = null, released_by = null }) {
  const row = await ReferralStorage.release(conn, { id_referral, reason, released_by });
  if (row) {
    log.info("referral.released", { id_referral, reason });
    await AffiliateStorage.writeAudit(conn, {
      entity: "user_referral",
      entity_id: id_referral,
      action: "release",
      after_state: row,
      reason,
      actor_user_id: released_by,
    }).catch(() => {});
  }
  return row;
}

module.exports = { bind, resolve, release, isPlatformContext };
