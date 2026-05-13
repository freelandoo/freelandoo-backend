const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const ProfileServiceController = require("../controllers/ProfileServiceController");
const uploadPortfolioMedia = require("../middlewares/uploadPortfolioMedia");
const asyncHandler = require("../utils/asyncHandler");

const router = Router({ mergeParams: true });

router.get("/", authMiddleware, asyncHandler(ProfileServiceController.list));
router.post("/", authMiddleware, asyncHandler(ProfileServiceController.create));
router.patch("/:id_profile_service", authMiddleware, asyncHandler(ProfileServiceController.update));
router.delete("/:id_profile_service", authMiddleware, asyncHandler(ProfileServiceController.remove));

// ─── Mídias do serviço ─────────────────────────────────────────────
router.get("/:id_profile_service/media", authMiddleware, asyncHandler(ProfileServiceController.listMedia));
router.post("/:id_profile_service/media", authMiddleware, uploadPortfolioMedia.single("file"), asyncHandler(ProfileServiceController.uploadMedia));
router.patch("/:id_profile_service/media/reorder", authMiddleware, asyncHandler(ProfileServiceController.reorderMedia));
router.delete("/:id_profile_service/media/:id_service_media", authMiddleware, asyncHandler(ProfileServiceController.deleteMedia));

module.exports = router;
