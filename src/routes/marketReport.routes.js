// src/routes/marketReport.routes.js
// Relatório de mercado local: GET /local-market/report e /local-market/my-communities.
// ⚠️ NÃO MONTAR EM /market: `/market/snapshot` (cotações da Carteira) é público
// e montado na raiz — o router.use(auth) daqui o trancaria.
// Só logado (o relatório é da plataforma para quem trabalha nela) e sob a flag
// `mercado_local` (kill-switch; nasce ligada na mig 269).
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const rateLimit = require("../middlewares/rateLimit");
const asyncHandler = require("../utils/asyncHandler");
const { sendServiceResult } = require("../utils/sendServiceResult");
const MarketReportService = require("../services/MarketReportService");

const router = Router();
router.use(authMiddleware, requireFeature("mercado_local"));

router.get(
  "/report",
  rateLimit.lookup,
  asyncHandler(async (req, res) => sendServiceResult(res, await MarketReportService.report(req.user, req.query)))
);
router.get(
  "/my-communities",
  asyncHandler(async (req, res) => sendServiceResult(res, await MarketReportService.myCommunities(req.user)))
);

module.exports = router;
