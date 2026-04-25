const { Router } = require("express");
const ProfileController = require("../controllers/ProfileController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// GET /public/creator/:handle/:profession_slug → resolve perfil específico
router.get(
  "/:handle/:profession_slug",
  asyncHandler(ProfileController.getPublicByHandle)
);

// GET /public/creator/:handle → resolve perfil canônico (mais recente publicado)
router.get(
  "/:handle",
  asyncHandler(ProfileController.resolveCanonicalByHandle)
);

module.exports = router;
