const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const MachineAdminController = require("../controllers/MachineAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/machines", ...admin, asyncHandler(MachineAdminController.listAll));
router.post("/machines", ...admin, asyncHandler(MachineAdminController.create));
router.delete("/machines/:id_machine", ...admin, asyncHandler(MachineAdminController.remove));
router.patch("/machines/:id_machine", ...admin, asyncHandler(MachineAdminController.update));
router.patch(
  "/machines/:id_machine/status",
  ...admin,
  asyncHandler(MachineAdminController.updateStatus)
);
router.post(
  "/machines/:id_machine/categories",
  ...admin,
  asyncHandler(MachineAdminController.addCategory)
);
router.patch(
  "/categories/:id_category",
  ...admin,
  asyncHandler(MachineAdminController.updateCategory)
);

module.exports = router;
