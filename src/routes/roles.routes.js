const express = require("express");
const RolesController = require("../controllers/RolesController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.get(
  "/",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(RolesController.list)
);
router.get(
  "/:id",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(RolesController.getById)
);
router.post(
  "/",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(RolesController.create)
);
router.put(
  "/:id",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(RolesController.update)
);
router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(RolesController.remove)
);

module.exports = router;
