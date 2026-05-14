const { Router } = require("express");
const UserPublicController = require("../controllers/UserPublicController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// GET /public/users/:handle/account-summary
router.get(
  "/:handle/account-summary",
  asyncHandler(UserPublicController.accountSummary)
);

module.exports = router;
