const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const AnnualFeeAdminController = require("../controllers/AnnualFeeAdminController");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/", ...admin, asyncHandler(AnnualFeeAdminController.get));
router.put("/", ...admin, asyncHandler(AnnualFeeAdminController.update));

module.exports = router;
