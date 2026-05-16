const { Router } = require("express");
const ProfileProductController = require("../controllers/ProfileProductController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router({ mergeParams: true });

router.get("/:id_profile/products", asyncHandler(ProfileProductController.listPublic));
router.get("/:id_profile/products/:id_profile_product", asyncHandler(ProfileProductController.getPublicById));

module.exports = router;
