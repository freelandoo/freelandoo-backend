const { Router } = require("express");
const MachineController = require("../controllers/MachineController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/", asyncHandler(MachineController.listPublic));
router.get(
  "/:id_machine/categories",
  asyncHandler(MachineController.listCategories)
);

module.exports = router;
