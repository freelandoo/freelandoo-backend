const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const ProfileProductController = require("../controllers/ProfileProductController");
const uploadPortfolioMedia = require("../middlewares/uploadPortfolioMedia");
const asyncHandler = require("../utils/asyncHandler");

const router = Router({ mergeParams: true });

router.get("/", authMiddleware, asyncHandler(ProfileProductController.list));
router.post("/", authMiddleware, asyncHandler(ProfileProductController.create));
router.patch("/:id_profile_product", authMiddleware, asyncHandler(ProfileProductController.update));
router.delete("/:id_profile_product", authMiddleware, asyncHandler(ProfileProductController.remove));

// ─── Mídias do produto ────────────────────────────────────────────────
router.get("/:id_profile_product/media", authMiddleware, asyncHandler(ProfileProductController.listMedia));
router.post("/:id_profile_product/media", authMiddleware, uploadPortfolioMedia.single("file"), asyncHandler(ProfileProductController.uploadMedia));
router.patch("/:id_profile_product/media/reorder", authMiddleware, asyncHandler(ProfileProductController.reorderMedia));
router.delete("/:id_profile_product/media/:id_product_media", authMiddleware, asyncHandler(ProfileProductController.deleteMedia));

module.exports = router;
