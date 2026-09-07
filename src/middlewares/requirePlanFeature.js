// src/middlewares/requirePlanFeature.js
// Exige que o usuário TENHA a função — por compra vitalícia ou por plano ativo
// (mig 225). Complementa o `requireFeature`, que é outra pergunta: aquele é o
// kill-switch global do admin, este é a posse de quem está batendo na porta.
//
// ─── POR QUE ESTE GATE É DE BACKEND, E NÃO SÓ DA UI ─────────────────────────
//
// A Loja de Funções sempre gateou pela interface (`useUserFeature` esconde a
// entrada), e para função comprada isso basta: o pior caso é alguém abrir uma
// tela que não usa. Aqui não — a porta que este middleware protege é a que
// LEVANTA UMA SESSÃO DE WHATSAPP, e uma sessão de pé custa memória todos os
// dias enquanto existir (foi a razão da mig 224 desligar as ociosas). Um gate
// só de tela deixaria qualquer requisição direta abrir um custo recorrente.
//
// ─── FAIL-CLOSED, AO CONTRÁRIO DO requireFeature ────────────────────────────
//
// O `requireFeature` deixa passar quando a checagem falha (não derrubar o site
// por causa de infra). Aqui não dá: falha na checagem que libera é falha que
// entrega recurso pago de graça, e sem barulho nenhum. Erro aqui recusa.
const PlanService = require("../services/PlanService");
const { createLogger } = require("../utils/logger");

const log = createLogger("requirePlanFeature");

function requirePlanFeature(key) {
  return async function planGate(req, res, next) {
    const id_user = req.user && req.user.id_user;
    if (!id_user) return res.status(401).json({ error: "Não autenticado" });

    try {
      const has = await PlanService.hasFeature(id_user, key);
      if (has) return next();

      // A recusa DIZ O QUE FAZER. Um 403 seco manda a pessoa procurar defeito
      // onde não há: ela não está quebrada, está fora do plano.
      const plan = await PlanService.planSellingFeature(key);
      return res.status(402).json({
        error: plan
          ? `Esta função faz parte do plano ${plan.name}.`
          : "Esta função não está disponível na sua conta.",
        needs_plan: plan ? plan.slug : null,
        plan_name: plan ? plan.name : null,
        plan_price_cents: plan ? plan.price_cents : null,
        feature_key: key,
      });
    } catch (e) {
      log.error("plan_gate.fail", { key, id_user, message: e && e.message });
      return res.status(503).json({ error: "Não foi possível verificar seu plano agora." });
    }
  };
}

module.exports = requirePlanFeature;
