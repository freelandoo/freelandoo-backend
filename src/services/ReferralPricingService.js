const AffiliateProgramStorage = require("../storages/AffiliateProgramStorage");
const AffiliateStorage = require("../storages/AffiliateStorage");
const ReferralService = require("./ReferralService");
const { createLogger } = require("../utils/logger");

const log = createLogger("ReferralPricingService");

const EMPTY = {
  has_referral: false,
  pool_cents: 0,
  commission_cents: 0,
  discount_cents: 0,
  charge_cents: null,
  id_referral: null,
  id_affiliate: null,
  affiliate_username: null,
};

/**
 * Desconto do vínculo em compras da PLATAFORMA (desenho de 2026-08-05, V3).
 *
 * Só a plataforma dá desconto — o pool do item de usuário é dinheiro do dono,
 * destinado a pagar quem vende por ele, e vira 100% comissão.
 *
 *   pool     = base × rule.percent / 100          (% do admin, por tipo de compra)
 *   comissão = pool × split / 100                 (split global)
 *   desconto = pool − comissão                    (o que volta pro comprador)
 *
 * O desconto vale já na PRIMEIRA compra (a que semeia o vínculo) — é o gancho
 * do programa. Por isso o `id_affiliate` pode chegar de fora (cupom da sessão)
 * quando o comprador ainda não tem vínculo.
 *
 * Nunca lança: falha vira desconto zero (o comprador paga o preço cheio).
 *
 * @param {Object} conn
 * @param {Object} params
 * @param {string} params.id_user            comprador
 * @param {string} params.source_context     ex.: 'profile_subscription'
 * @param {number} params.base_cents         valor sobre o qual o pool incide
 * @param {string|null} [params.id_affiliate_hint] afiliado do cupom da sessão,
 *   quando o comprador ainda não tem vínculo (1ª compra).
 */
async function resolve(conn, { id_user, source_context, base_cents, id_affiliate_hint = null }) {
  try {
    const base = Math.max(0, Math.round(Number(base_cents) || 0));
    if (!base || !source_context) return { ...EMPTY };

    const rule = await AffiliateProgramStorage.getRule(conn, source_context);
    if (!rule || rule.is_enabled !== true) return { ...EMPTY };
    if (rule.regime !== "platform" || rule.grants_discount !== true) return { ...EMPTY };
    if (rule.min_order_cents && base < Number(rule.min_order_cents)) return { ...EMPTY };

    const referral = await ReferralService.resolve(conn, id_user);
    const id_affiliate = referral?.id_affiliate || id_affiliate_hint || null;
    if (!id_affiliate) return { ...EMPTY };

    // Ninguém ganha desconto por indicar a si mesmo.
    const affiliate = await AffiliateStorage.getAffiliateById(conn, id_affiliate);
    if (!affiliate || affiliate.status !== "ACTIVE") return { ...EMPTY };
    if (String(affiliate.id_user) === String(id_user)) return { ...EMPTY };

    let pool_cents = Math.round((base * Number(rule.percent || 0)) / 100);
    if (rule.max_pool_cents != null) {
      pool_cents = Math.min(pool_cents, Number(rule.max_pool_cents));
    }
    if (pool_cents <= 0) return { ...EMPTY };

    const program = await AffiliateProgramStorage.getSettings(conn);
    const split = Number(program?.commission_split_percent);
    const splitPct = Number.isFinite(split) ? Math.min(Math.max(split, 0), 100) : 100;

    const commission_cents = Math.round((pool_cents * splitPct) / 100);
    const discount_cents = Math.max(0, pool_cents - commission_cents);

    // Trava de segurança: o desconto nunca pode zerar (nem virar) a cobrança.
    const safeDiscount = Math.min(discount_cents, Math.max(0, base - 1));

    return {
      has_referral: !!referral,
      pool_cents,
      commission_cents,
      discount_cents: safeDiscount,
      charge_cents: base - safeDiscount,
      id_referral: referral?.id_referral || null,
      id_affiliate,
      affiliate_username: null,
    };
  } catch (err) {
    log.error("referral_pricing.fail", { message: err.message, source_context });
    return { ...EMPTY };
  }
}

/**
 * Resumo do vínculo para o front (selo do checkout e transparência na conta):
 * quem indicou e quanto de desconto vale hoje naquele tipo de compra.
 */
async function summaryForUser(conn, id_user, { source_context = null, base_cents = 0 } = {}) {
  const referral = await ReferralService.resolve(conn, id_user);
  if (!referral) return { referral: null };

  const { rows } = await conn.query(
    `SELECT u.username, u.nome AS display_name
       FROM public.tb_affiliate a
       JOIN public.tb_user u ON u.id_user = a.id_user
      WHERE a.id_affiliate = $1
      LIMIT 1`,
    [referral.id_affiliate]
  );
  const who = rows[0] || null;

  let pricing = null;
  if (source_context && base_cents > 0) {
    pricing = await resolve(conn, { id_user, source_context, base_cents });
  }

  return {
    referral: {
      id_referral: referral.id_referral,
      bound_at: referral.bound_at,
      affiliate_username: who?.username || null,
      affiliate_name: who?.display_name || null,
      discount_cents: pricing?.discount_cents || 0,
      charge_cents: pricing?.charge_cents ?? null,
    },
  };
}

module.exports = { resolve, summaryForUser };
