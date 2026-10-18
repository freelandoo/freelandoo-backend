// Administração MÍNIMA dos outdoors da Arena (M11): só LEITURA de estado e
// métricas agregadas, para a conta Administrator. Escrever (aprovar, agendar,
// reservar, pausar) é pela CLI scripts/arena-ads-ops.js, que simula por padrão.
// Não é o painel do M16.
//
//   GET /admin/arena/ads/campaigns/:code   estado, criativos e reservas
//   GET /admin/arena/ads/metrics?campaign=&from=&to=   agregados (sem dado pessoal)

const { Router } = require("express");
const pool = require("../databases");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const ArenaAdOps = require("../services/ArenaAdOps");
const ArenaAdService = require("../services/ArenaAdService");
const rules = require("../utils/arenaAds");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get(
  "/ads/campaigns/:code",
  ...admin,
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!rules.isCampaignCode(req.params.code)) return res.status(400).json({ error: "código inválido", code: "invalid_input" });
    const out = await ArenaAdOps.status(pool, { code: req.params.code });
    return res.status(out.ok ? 200 : 404).json(out);
  })
);

router.get(
  "/ads/metrics",
  ...admin,
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const out = await ArenaAdService.metrics(req.query);
    return res.status(out.status).json(out.body);
  })
);

module.exports = router;
