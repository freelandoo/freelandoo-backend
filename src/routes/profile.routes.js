const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const ProfileController = require("../controllers/ProfileController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.post("/", authMiddleware, asyncHandler(ProfileController.create));

router.get("/user/:id_user", asyncHandler(ProfileController.listByUser));

router.get("/:id_profile", asyncHandler(ProfileController.getById));
router.patch(
  "/:id_profile",
  authMiddleware,
  asyncHandler(ProfileController.update)
);
router.delete(
  "/:id_profile",
  authMiddleware,
  asyncHandler(ProfileController.remove)
);

router.post(
  "/:id_profile/status",
  authMiddleware,
  asyncHandler(ProfileController.setStatus)
);

router.patch(
  "/:id_profile/visibility",
  authMiddleware,
  asyncHandler(ProfileController.setVisibility)
);

module.exports = router;
