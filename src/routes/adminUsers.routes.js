const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const AdminUsersController = require("../controllers/AdminUsersController");
const AdminTransactionsController = require("../controllers/AdminTransactionsController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/users", ...admin, asyncHandler(AdminUsersController.listAll));
router.get("/transactions", ...admin, asyncHandler(AdminTransactionsController.listAll));

module.exports = router;
