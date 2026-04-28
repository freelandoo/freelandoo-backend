const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const AdminUsersController = require("../controllers/AdminUsersController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/users", ...admin, asyncHandler(AdminUsersController.listAll));

module.exports = router;
