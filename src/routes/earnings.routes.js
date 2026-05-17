const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const EarningsController = require("../controllers/EarningsController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/me/earnings", authMiddleware, asyncHandler(EarningsController.listMine));

module.exports = router;
