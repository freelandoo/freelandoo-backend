const FinanceService = require("../services/FinanceService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class FinanceController {
  static async getPlatform(req, res) {
    const result = await FinanceService.getPlatform();
    return sendServiceResult(res, result);
  }

  static async ranking(req, res) {
    const result = await FinanceService.ranking(req.user?.id_user, req.query || {});
    return sendServiceResult(res, result);
  }

  /**
   * A batida de presença no Financeiro. Sem corpo: quem mede o tempo é o banco.
   *
   * `?resume=1` significa "só acerte o relógio, não credite" — é o que o
   * navegador manda ao voltar de uma aba que ficou escondida.
   */
  static async presenceBeat(req, res) {
    const result = await FinanceService.beat(req.user.id_user, {
      resume: req.query.resume === "1" || req.query.resume === "true",
    });
    return sendServiceResult(res, result);
  }
}

module.exports = FinanceController;
