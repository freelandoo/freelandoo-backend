const AffiliateStorage = require("../storages/AffiliateStorage");

/**
 * Resolve a regra de comissão vigente para um cupom em um dado momento.
 *
 * Prioridade: override específico do cupom > settings global vigente.
 * Retorna null quando nenhuma settings global foi configurada ainda —
 * nesse caso nenhuma conversão deve ser criada.
 *
 * O retorno inclui um `snapshot` plano, pronto pra ser persistido em
 * tb_affiliate_conversion.rule_snapshot (imutabilidade histórica).
 */
async function resolve(conn, { id_coupon, at = null }) {
  const settings = await AffiliateStorage.getEffectiveSettings(conn, at);
  if (!settings) return null;

  const override = await AffiliateStorage.getCouponOverride(conn, id_coupon);

  const commission_percent =
    override?.commission_percent != null
      ? Number(override.commission_percent)
      : Number(settings.default_commission_percent);

  const commission_base =
    override?.commission_base || settings.commission_base;

  const max_commission_cents =
    override?.max_commission_cents != null
      ? override.max_commission_cents
      : settings.max_commission_cents; // pode ser null (sem teto)

  const approval_delay_days =
    override?.approval_delay_days != null
      ? override.approval_delay_days
      : settings.approval_delay_days;

  const min_order_cents = settings.min_order_cents || 0;

  return {
    commission_percent,
    commission_base,
    max_commission_cents,
    approval_delay_days,
    min_order_cents,
    snapshot: {
      source: override ? "override" : "global",
      settings_id: settings.id_settings,
      override_id: override?.id_override || null,
      commission_percent,
      commission_base,
      max_commission_cents,
      approval_delay_days,
      min_order_cents,
      resolved_at: new Date().toISOString(),
    },
  };
}

/**
 * Calcula a comissão a partir do total, desconto e regra resolvida.
 * Retorna { base_cents, commission_cents } ou null se min_order não atingido.
 */
function calculate({ order_total_cents, discount_cents, rule }) {
  if (order_total_cents < rule.min_order_cents) return null;

  const base_cents =
    rule.commission_base === "GROSS"
      ? order_total_cents
      : Math.max(0, order_total_cents - discount_cents);

  let commission_cents = Math.floor((base_cents * rule.commission_percent) / 100);

  if (rule.max_commission_cents != null) {
    commission_cents = Math.min(commission_cents, rule.max_commission_cents);
  }

  return { base_cents, commission_cents };
}

module.exports = { resolve, calculate };
