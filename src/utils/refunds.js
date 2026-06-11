/**
 * Helpers de reembolso Stripe compartilhados entre os handlers de charge.refunded.
 *
 * Antes do projeto PayDebug, todos os handlers tratavam QUALQUER charge.refunded
 * como reembolso total — um estorno parcial (ex.: devolver só o frete) zerava
 * estoque, saldo do vendedor, matrícula etc. indevidamente. Agora a reversão
 * automática só roda em reembolso TOTAL; o parcial é deixado para tratamento
 * manual (logado), porque a divisão exata depende da regra de negócio.
 */

/**
 * True quando o charge foi reembolsado integralmente.
 * Stripe: `amount` = valor cobrado, `amount_refunded` = total já estornado.
 */
function isFullRefund(charge) {
  if (!charge) return false;
  const amount = Number(charge.amount);
  const refunded = Number(charge.amount_refunded);
  if (!Number.isFinite(amount) || amount <= 0) {
    // Sem o valor base, cai no comportamento conservador legado (trata como total).
    return true;
  }
  if (!Number.isFinite(refunded)) return true;
  return refunded >= amount;
}

module.exports = { isFullRefund };
