const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const EntityFollowController = require("../controllers/EntityFollowController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/actors", authMiddleware, asyncHandler(EntityFollowController.listActors));
router.post("/", authMiddleware, asyncHandler(EntityFollowController.follow));
router.delete("/", authMiddleware, asyncHandler(EntityFollowController.unfollow));
router.delete(
  "/:target_type/:target_id",
  authMiddleware,
  asyncHandler(EntityFollowController.unfollow)
);
router.get("/status", authMiddleware, asyncHandler(EntityFollowController.status));

router.get("/counts", asyncHandler(EntityFollowController.counts));
router.get("/followers", asyncHandler(EntityFollowController.followers));
router.get("/following", asyncHandler(EntityFollowController.following));

module.exports = router;
