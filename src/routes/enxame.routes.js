const { Router } = require("express");
const EnxameController = require("../controllers/EnxameController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/", asyncHandler(EnxameController.listPublic));
router.get(
  "/:id_enxame/categories",
  asyncHandler(EnxameController.listCategories)
);

module.exports = router;
