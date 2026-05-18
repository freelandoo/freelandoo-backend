const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const NavCountsController = require("../controllers/NavCountsController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get(
  "/nav-counts",
  authMiddleware,
  asyncHandler(NavCountsController.summary)
);

module.exports = router;
