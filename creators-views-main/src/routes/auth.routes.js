const { Router } = require("express");
const AuthController = require("../controllers/AuthController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.post("/signup", asyncHandler(AuthController.signup));
router.post("/signin", asyncHandler(AuthController.signin));
router.get("/activate", asyncHandler(AuthController.activate));
router.post("/forgot-password", asyncHandler(AuthController.forgotPassword));
router.post("/reset-password", asyncHandler(AuthController.resetPassword));

module.exports = router;
