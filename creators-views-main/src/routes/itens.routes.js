const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const ItemController = require("../controllers/ItemController");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.get(
  "/",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(ItemController.getItens)
);
router.get(
  "/:id_item",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(ItemController.getItemById)
);
router.post(
  "/",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(ItemController.createItem)
);
router.put(
  "/:id_item",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(ItemController.updateItem)
);
router.patch(
  "/:id_item/active",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(ItemController.toggleItemActive)
);
router.delete(
  "/:id_item",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(ItemController.deleteItem)
);

module.exports = router;
