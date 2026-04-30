const { Router } = require("express");
const asyncHandler = require("../utils/asyncHandler");
const BookingFeeAdminController = require("../controllers/BookingFeeAdminController");

const router = Router();

router.get("/", asyncHandler(BookingFeeAdminController.getPublic));

module.exports = router;
