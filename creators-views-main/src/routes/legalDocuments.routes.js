const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const LegalDocumentsController = require("../controllers/LegalDocumentsController");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(LegalDocumentsController.list));

router.get(
  "/active/:document_type",
  asyncHandler(LegalDocumentsController.getActiveByType)
);

router.get("/:id", asyncHandler(LegalDocumentsController.getById));

router.post(
  "/",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(LegalDocumentsController.create)
);

router.put(
  "/:id",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(LegalDocumentsController.update)
);

router.post(
  "/:id/activate",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(LegalDocumentsController.activate)
);

router.post(
  "/:id/deactivate",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(LegalDocumentsController.deactivate)
);

module.exports = router;
