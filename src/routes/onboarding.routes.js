const { Router } = require("express");
const OnboardingController = require("../controllers/OnboardingController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.post(
  "/birthdate",
  authMiddleware,
  asyncHandler(OnboardingController.submitBirthdate),
);

module.exports = router;
