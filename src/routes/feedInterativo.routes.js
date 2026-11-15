// Feed Interativo (migs 456+): /feed-interativo/*. Tudo logado e atrás da flag
// 'feed_interativo' do Painel de Controle (fail-open como as outras).
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const asyncHandler = require("../utils/asyncHandler");
const C = require("../controllers/FeedInterativoController");

const router = Router();
router.use(authMiddleware, requireFeature("feed_interativo"));

router.get("/links", asyncHandler(C.links));
router.post("/links", asyncHandler(C.invite));
router.post("/links/:id_link/:action", asyncHandler(C.act));
router.get("/prefs", asyncHandler(C.getPrefs));
router.put("/prefs", asyncHandler(C.setPrefs));
router.get("/targets", asyncHandler(C.targets));
router.post("/throw", asyncHandler(C.throwPost));
router.get("/inbox", asyncHandler(C.inbox));
router.post("/seen", asyncHandler(C.seen));

module.exports = router;
