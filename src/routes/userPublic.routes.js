const { Router } = require("express");
const UserPublicController = require("../controllers/UserPublicController");
const SubjectCommunityController = require("../controllers/SubjectCommunityController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// GET /public/users/:handle/account-summary
router.get(
  "/:handle/account-summary",
  asyncHandler(UserPublicController.accountSummary)
);

// GET /public/users/:handle/spaces — negócio, pet e carro que a pessoa lidera:
// os pills que o visitante vê atrás da foto dela.
router.get(
  "/:handle/spaces",
  asyncHandler(SubjectCommunityController.publicSpaces)
);

module.exports = router;
