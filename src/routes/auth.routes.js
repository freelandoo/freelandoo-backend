const { Router } = require("express");
const AuthController = require("../controllers/AuthController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.post("/signup", asyncHandler(AuthController.signup));
router.get("/check-username", asyncHandler(AuthController.checkUsername));
router.post("/signin", asyncHandler(AuthController.signin));
router.get("/activate", asyncHandler(AuthController.activate));
router.post(
  "/resend-activation",
  authMiddleware,
  asyncHandler(AuthController.resendActivation)
);
router.post(
  "/change-email",
  authMiddleware,
  asyncHandler(AuthController.changeEmail)
);
router.post("/forgot-password", asyncHandler(AuthController.forgotPassword));
router.post("/reset-password", asyncHandler(AuthController.resetPassword));

module.exports = router;
