const { Router } = require("express");
const ProfileServiceController = require("../controllers/ProfileServiceController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router({ mergeParams: true });

router.get("/:id_profile/services", asyncHandler(ProfileServiceController.listPublic));

module.exports = router;
