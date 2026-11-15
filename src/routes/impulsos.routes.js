// Freelandoo Ads — "Impulsionar" (mig 461): /impulsos/*. Tudo logado.
// (Nome sem "ads" de propósito: bloqueador de anúncio derruba rota /ads.)
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const AdsService = require("../services/AdsService");
const { sendServiceResult } = require("../utils/sendServiceResult");

const router = Router();
router.use(authMiddleware);
const h = (fn) => asyncHandler(async (req, res) => sendServiceResult(res, await fn(req)));

router.get("/config", h((req) => AdsService.config(req.user)));
router.get("/estimativa", h((req) => AdsService.estimate(req.user, req.query || {})));
router.get("/", h((req) => AdsService.listMine(req.user)));
router.post("/", h((req) => AdsService.create(req.user, req.body || {})));
router.post("/eventos", h((req) => AdsService.recordEvent(req.user, req.body || {})));
router.get("/:id_campaign", h((req) => AdsService.detail(req.user, req.params.id_campaign)));
router.post("/:id_campaign/:action", h((req) => AdsService.act(req.user, req.params.id_campaign, req.params.action)));

module.exports = router;
