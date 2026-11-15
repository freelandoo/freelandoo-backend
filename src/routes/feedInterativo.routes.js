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
router.post("/gift", asyncHandler(C.gift));
router.post("/drops/:id_drop/open", asyncHandler(C.openGift));
router.get("/stickers", asyncHandler(C.stickers));
router.post("/capsules", asyncHandler(C.scheduleCapsule));
router.get("/capsules", asyncHandler(C.listCapsules));
router.post("/capsules/:id_drop/cancel", asyncHandler(C.cancelCapsule));
router.post("/sync", asyncHandler(C.syncInvite));
router.get("/sync/:id_session", asyncHandler(C.syncGet));
router.post("/sync/:id_session/:action", asyncHandler(C.syncAct));
router.get("/posts", asyncHandler(C.posts));

module.exports = router;
