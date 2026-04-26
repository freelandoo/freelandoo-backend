const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const ProfileServiceController = require("../controllers/ProfileServiceController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router({ mergeParams: true });

router.get("/", authMiddleware, asyncHandler(ProfileServiceController.list));
router.post("/", authMiddleware, asyncHandler(ProfileServiceController.create));
router.patch("/:id_profile_service", authMiddleware, asyncHandler(ProfileServiceController.update));
router.delete("/:id_profile_service", authMiddleware, asyncHandler(ProfileServiceController.remove));

module.exports = router;
