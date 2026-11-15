// Paths (Feed Interativo F5, mig 458): /paths/*. Atrás da flag feed_interativo.
// Do autor = logado; do player (pelo post do feed) = login opcional.
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const asyncHandler = require("../utils/asyncHandler");
const PathService = require("../services/PathService");
const { sendServiceResult } = require("../utils/sendServiceResult");

const router = Router();
router.use(requireFeature("feed_interativo"));
const h = (fn) => asyncHandler(async (req, res) => sendServiceResult(res, await fn(req)));

// player (literal antes da paramétrica)
router.get("/by-post/:post_id", optionalAuthMiddleware, h((req) => PathService.forPlayer(req.user, req.params.post_id)));
router.post("/:id_story/play", optionalAuthMiddleware, h((req) => PathService.play(req.params.id_story)));
router.post("/:id_story/pick", optionalAuthMiddleware, h((req) => PathService.pick(req.params.id_story, req.body || {})));

// autor
router.get("/", authMiddleware, h((req) => PathService.listMine(req.user)));
router.post("/", authMiddleware, h((req) => PathService.create(req.user, req.body || {})));
router.get("/:id_story", authMiddleware, h((req) => PathService.getForEdit(req.user, req.params.id_story)));
router.put("/:id_story", authMiddleware, h((req) => PathService.save(req.user, req.params.id_story, req.body || {})));
router.post("/:id_story/publish", authMiddleware, h((req) => PathService.publish(req.user, req.params.id_story, req.body || {})));
router.post("/:id_story/unpublish", authMiddleware, h((req) => PathService.unpublish(req.user, req.params.id_story)));
router.delete("/:id_story", authMiddleware, h((req) => PathService.remove(req.user, req.params.id_story)));

module.exports = router;
