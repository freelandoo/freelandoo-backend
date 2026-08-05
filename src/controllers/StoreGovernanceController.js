const StoreGovernanceService = require("../services/StoreGovernanceService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class StoreGovernanceController {
  static async get(req, res) {
    const result = await StoreGovernanceService.getSettings();
    return sendServiceResult(res, result);
  }

  static async update(req, res) {
    const result = await StoreGovernanceService.updateSettings(req.user, req.body);
    return sendServiceResult(res, result);
  }

  static async pricePreview(req, res) {
    const sellerCents = req.query?.seller_cents;
    const affiliatesAllowed =
      req.query?.affiliates_allowed === "true" || req.query?.affiliates_allowed === "1";
    // % do próprio item (mig 192). Ausente = default global.
    const raw = req.query?.affiliate_percent;
    const affiliatePercent =
      raw === undefined || raw === null || raw === "" ? null : Number(raw);
    const result = await StoreGovernanceService.pricePreview(sellerCents, {
      affiliatesAllowed,
      affiliatePercent,
    });
    return sendServiceResult(res, result);
  }

  /**
   * Trilhos do programa de afiliados — o modal de produto/serviço/curso usa
   * para saber o piso, o teto e o default sugerido do campo de porcentagem.
   */
  static async affiliateProgram(req, res) {
    const result = await StoreGovernanceService.getAffiliateProgram();
    return sendServiceResult(res, result);
  }
}

module.exports = StoreGovernanceController;
