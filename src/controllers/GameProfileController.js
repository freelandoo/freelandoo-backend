// src/controllers/GameProfileController.js
// Camada fina do perfil gamer (mig 220). Todos os guards — flag, state
// assinado, visibilidade da estante, TTL de sync — moram no GameProfileService.

const GameProfileService = require("../services/GameProfileService");
const { sendServiceResult } = require("../utils/sendServiceResult");

class GameProfileController {
  static async listProviders(req, res) {
    const result = await GameProfileService.listProviders(req.user.id_user);
    return sendServiceResult(res, result);
  }

  static async startConnect(req, res) {
    const result = await GameProfileService.startConnect(
      req.user.id_user,
      req.params.provider,
      // De onde a pessoa saiu, para devolvê-la ali. Validado no service: só
      // caminho relativo entra, e ele viaja assinado dentro do state.
      req.query.return
    );
    return sendServiceResult(res, result);
  }

  /**
   * A ÚNICA rota deste módulo sem `authMiddleware`, e é de propósito: quem
   * chega aqui é o NAVEGADOR voltando da plataforma, redirecionado por ela —
   * não há Authorization nessa viagem. Quem faz o papel do token é o `state`
   * assinado, conferido no service.
   *
   * E ela responde 302, não JSON: a pessoa está numa aba, olhando. Um `{ok:true}`
   * na tela seria o fim da jornada num beco.
   */
  static async finishConnect(req, res) {
    const result = await GameProfileService.finishConnect(req.params.provider, req.query || {});
    if (result && result.error) {
      const base = String(process.env.FRONTEND_URL || "https://www.freelandoo.com.br").replace(/\/+$/, "");
      // O erro volta para o site como parâmetro — e a tela é que decide como
      // dizer. Devolver JSON aqui deixaria a pessoa parada no domínio do
      // backend, sem caminho de volta.
      return res.redirect(302, `${base}/account?games=erro&motivo=${encodeURIComponent(result.error)}`);
    }
    return res.redirect(302, result.redirect);
  }

  static async disconnect(req, res) {
    const result = await GameProfileService.disconnect(req.user.id_user, req.params.provider);
    return sendServiceResult(res, result);
  }

  static async setVisibility(req, res) {
    const result = await GameProfileService.setVisibility(
      req.user.id_user,
      req.params.provider,
      (req.body || {}).visibility
    );
    return sendServiceResult(res, result);
  }

  static async syncNow(req, res) {
    const result = await GameProfileService.syncNow(req.user.id_user, req.params.provider);
    return sendServiceResult(res, result);
  }

  static async myShelf(req, res) {
    const result = await GameProfileService.myShelf(req.user.id_user, {
      limit: Math.min(Number(req.query.limit) || 60, 200),
      offset: Math.max(Number(req.query.offset) || 0, 0),
      q: req.query.q ? String(req.query.q).slice(0, 80) : null,
    });
    return sendServiceResult(res, result);
  }

  static async ranking(req, res) {
    const result = await GameProfileService.ranking(req.user.id_user, {
      limit: req.query.limit,
    });
    return sendServiceResult(res, result);
  }

  /**
   * A fila de atividade (cidade/estado). O escopo vem da querystring e e
   * normalizado no util - valor desconhecido cai em "city" em vez de virar
   * erro: a tela nunca deve quebrar por causa de um parametro de aba.
   */
  static async activityRanking(req, res) {
    const result = await GameProfileService.activityRanking(req.user.id_user, {
      scope: req.query.scope,
      limit: req.query.limit,
    });
    return sendServiceResult(res, result);
  }

  /**
   * A batida de presenca. Sem corpo: quem mede o tempo e o banco.
   *
   * `?resume=1` significa "so acerte o relogio, nao credite" — e o que o
   * navegador manda ao voltar de uma aba que ficou escondida. Vir do cliente e
   * seguro porque a flag so DIMINUI a propria pontuacao de quem a manda.
   */
  static async presenceBeat(req, res) {
    const result = await GameProfileService.beat(req.user.id_user, {
      resume: req.query.resume === "1" || req.query.resume === "true",
    });
    return sendServiceResult(res, result);
  }

  static async userShelf(req, res) {
    const result = await GameProfileService.userShelf(req.user.id_user, req.params.id_user, {
      limit: Math.min(Number(req.query.limit) || 60, 200),
      offset: Math.max(Number(req.query.offset) || 0, 0),
    });
    return sendServiceResult(res, result);
  }

  static async compare(req, res) {
    const result = await GameProfileService.compare(req.user.id_user, req.params.username);
    return sendServiceResult(res, result);
  }

  static async achievements(req, res) {
    const result = await GameProfileService.gameAchievements(
      req.user.id_user,
      req.query.id_user || req.user.id_user,
      req.params.id_game,
      req.params.provider
    );
    return sendServiceResult(res, result);
  }
}

module.exports = GameProfileController;
