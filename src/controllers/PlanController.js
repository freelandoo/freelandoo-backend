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

  /**
   * O checkout volta para a PÁGINA DE ONDE SAIU (`return_to`, caminho relativo
   * do próprio site): quem assina de dentro do negócio cai de volta no negócio,
   * quem assina do construtor cai no construtor. Sem `return_to` vai para o
   * perfil. O caminho é validado (só relativo, sem `//`) — um redirect aberto
   * mandaria a pessoa para fora do site no fim do pagamento.
   */
  async createCheckout(req, res) {
    const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com.br").replace(/\/$/, "");
    const raw = typeof req.body?.return_to === "string" ? req.body.return_to.trim() : "";
    const returnTo = /^\/(?!\/)[^\s?#]*$/.test(raw) ? raw : "/account";
    return sendServiceResult(
      res,
      await PlanService.createCheckout(req.user, req.params.slug, {
        successUrl: `${frontend}${returnTo}?plano=sucesso&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${frontend}${returnTo}?plano=cancelado`,
      }),
      201
    );
  },

  async cancel(req, res) {
    return sendServiceResult(res, await PlanService.cancelMySubscription(req.user.id_user));
  },
};
