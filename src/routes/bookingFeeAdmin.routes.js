const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const BookingFeeAdminController = require("../controllers/BookingFeeAdminController");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/", ...admin, asyncHandler(BookingFeeAdminController.get));
router.put("/", ...admin, asyncHandler(BookingFeeAdminController.update));

module.exports = router;
