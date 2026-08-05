// Parser compartilhado do opt-in de afiliados por item (migrations 090 e 192).
// Usado por cursos, produtos de loja e serviços de perfil.
//
// O criador ACEITA ou RECUSA afiliados (`affiliates_allowed`) e, desde a mig 192,
// também define QUANTO do próprio valor destina ao programa (`affiliate_percent`).
// NULL = usa o default global do admin. Os trilhos (piso/teto) são aplicados no
// StoreGovernanceService.resolveAffiliatePercent — aqui só validamos a forma.
//
// Grava em `out` (o objeto de campos validados do service). Retorna uma
// string de erro se o valor for inválido, ou null se estiver tudo certo.

function parseAffiliateOptIn(payload, out) {
  if (Object.prototype.hasOwnProperty.call(payload, "affiliates_allowed")) {
    if (typeof payload.affiliates_allowed !== "boolean") {
      return "affiliates_allowed deve ser booleano";
    }
    out.affiliates_allowed = payload.affiliates_allowed;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "affiliate_percent")) {
    const raw = payload.affiliate_percent;
    if (raw === null || raw === "") {
      out.affiliate_percent = null; // volta pro default global
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return "affiliate_percent deve estar entre 0 e 100";
      }
      out.affiliate_percent = n;
    }
  }

  return null;
}

module.exports = { parseAffiliateOptIn };
