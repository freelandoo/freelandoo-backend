// src/middlewares/requireFeature.js
// Bloqueia a rota quando a responsabilidade está DESLIGADA no Painel de Controle.
// Uso: router.use(requireFeature("store"))  ou  em rotas específicas.
// Fail-open: erro na checagem deixa passar (não derruba a rota por infra).
const FeatureFlagService = require("../services/FeatureFlagService");

function requireFeature(key) {
  return async function featureGate(req, res, next) {
    try {
      const enabled = await FeatureFlagService.isEnabled(key);
      if (!enabled) {
        return res.status(403).json({
          error: "Recurso indisponível no momento.",
          feature_disabled: key,
        });
      }
    } catch {
      // fail-open
    }
    return next();
  };
}

module.exports = requireFeature;
