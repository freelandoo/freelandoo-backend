const BusinessIndicatorsService = require("../services/BusinessIndicatorsService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class BusinessIndicatorsController {
  /** O painel do líder: leads, site, agendamentos e faturamento. */
  static async get(req, res) {
    const result = await BusinessIndicatorsService.getIndicators(
      req.user,
      req.params.id_profile,
      req.query.days
    );
    return sendServiceResult(res, result);
  }

  /**
   * O beacon do site publicado — porta anônima.
   *
   * Responde 204 sempre, inclusive quando nada foi gravado: quem chama é o
   * navegador de um visitante, não tem o que fazer com um erro, e distinguir
   * "gravei" de "esse id não tem site" transformaria o contador numa forma de
   * varrer quais comunidades têm site publicado.
   */
  static async recordSiteEvent(req, res) {
    await BusinessIndicatorsService.recordSiteEvent(
      req.params.id_profile,
      req.body?.kind
    );
    return res.status(204).end();
  }
}

module.exports = BusinessIndicatorsController;
