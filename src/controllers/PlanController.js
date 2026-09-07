// src/controllers/PlanController.js
// Planos mensais (mig 225).
const PlanService = require("../services/PlanService");
const { sendServiceResult } = require("../utils/sendServiceResult");

module.exports = {
  /**
   * A vitrine dos planos. Autenticação OPCIONAL: visitante precisa ver o que
   * está à venda antes de decidir criar conta — exigir login aqui esconderia o
   * preço de quem ainda não é cliente, que é justamente quem precisa vê-lo.
   */
  async list(req, res) {
    return sendServiceResult(res, await PlanService.listPlans(req.user && req.user.id_user));
  },

  async mine(req, res) {
    return sendServiceResult(res, await PlanService.mySubscription(req.user.id_user));
  },

  async createCheckout(req, res) {
    const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com.br").replace(/\/$/, "");
    return sendServiceResult(
      res,
      await PlanService.createCheckout(req.user, req.params.slug, {
        successUrl: `${frontend}/planos?assinatura=sucesso&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${frontend}/planos?assinatura=cancelado`,
      }),
      201
    );
  },

  async cancel(req, res) {
    return sendServiceResult(res, await PlanService.cancelMySubscription(req.user.id_user));
  },
};
