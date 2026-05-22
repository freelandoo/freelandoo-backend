// Parser compartilhado do opt-in de afiliados por item (migration 090).
// Usado por cursos, produtos de loja e serviços de perfil.
//
// Lê `affiliates_allowed` e `affiliate_commission_pct` de um payload e grava
// em `out` (o objeto de campos validados do service). Retorna uma string de
// erro se algum valor for inválido, ou null se estiver tudo certo.

const COMMISSION_MIN = 0;
const COMMISSION_MAX = 90;

function parseAffiliateOptIn(payload, out) {
  if (Object.prototype.hasOwnProperty.call(payload, "affiliates_allowed")) {
    if (typeof payload.affiliates_allowed !== "boolean") {
      return "affiliates_allowed deve ser booleano";
    }
    out.affiliates_allowed = payload.affiliates_allowed;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "affiliate_commission_pct")) {
    const pct = Number(payload.affiliate_commission_pct);
    if (!Number.isFinite(pct) || pct < COMMISSION_MIN || pct > COMMISSION_MAX) {
      return `Comissão de afiliado deve estar entre ${COMMISSION_MIN} e ${COMMISSION_MAX}%`;
    }
    // Duas casas decimais (coluna é NUMERIC(5,2)).
    out.affiliate_commission_pct = Math.round(pct * 100) / 100;
  }

  return null;
}

module.exports = { parseAffiliateOptIn, COMMISSION_MIN, COMMISSION_MAX };
