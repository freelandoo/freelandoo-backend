const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const SiteAssetController = require("../controllers/SiteAssetController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Admin troca a imagem de um slot (multipart campo "image").
router.post(
  "/:slot_key",
  ...admin,
  uploadAvatar.single("image"),
  asyncHandler(SiteAssetController.upload)
);

// Admin remove a imagem de um slot (usado para apagar slides do carrossel).
router.delete("/:slot_key", ...admin, asyncHandler(SiteAssetController.remove));

module.exports = router;
