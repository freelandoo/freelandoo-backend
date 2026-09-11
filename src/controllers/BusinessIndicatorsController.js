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
   *
   * ⚠️ O `kind` VEM DA QUERYSTRING, e é o único lugar de onde ele vem. Quem
   * chama é um `navigator.sendBeacon` — o único transporte que sobrevive à
   * navegação que o clique em "Agendar" provoca —, e um corpo
   * `application/json` tornaria a requisição não-simples, obrigando um
   * preflight que o beacon não negocia. Sem corpo não há preflight nem parser.
   */
  static async recordSiteEvent(req, res) {
    await BusinessIndicatorsService.recordSiteEvent(
      req.params.id_profile,
      req.query?.kind
    );
    return res.status(204).end();
  }
}

module.exports = BusinessIndicatorsController;
