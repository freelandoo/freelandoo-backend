const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const asyncHandler = require("../utils/asyncHandler");
const AdminTourPathController = require("../controllers/AdminTourPathController");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Banner upload solto (antes ou depois de criar o path)
router.post(
  "/monetization-paths/uploads/banner",
  ...admin,
  uploadAvatar.single("banner"),
  asyncHandler(AdminTourPathController.uploadBanner)
);

// Paths CRUD
router.get("/monetization-paths", ...admin, asyncHandler(AdminTourPathController.listPaths));
router.post(
  "/monetization-paths",
  ...admin,
  uploadAvatar.single("banner"),
  asyncHandler(AdminTourPathController.createPath)
);
router.get("/monetization-paths/:id", ...admin, asyncHandler(AdminTourPathController.getPath));
router.put(
  "/monetization-paths/:id",
  ...admin,
  uploadAvatar.single("banner"),
  asyncHandler(AdminTourPathController.updatePath)
);
router.delete("/monetization-paths/:id", ...admin, asyncHandler(AdminTourPathController.deletePath));

// Steps
router.get("/monetization-paths/:id/steps", ...admin, asyncHandler(AdminTourPathController.listSteps));
router.post("/steps", ...admin, asyncHandler(AdminTourPathController.createStep));
router.put("/steps/:id", ...admin, asyncHandler(AdminTourPathController.updateStep));
router.delete("/steps/:id", ...admin, asyncHandler(AdminTourPathController.deleteStep));

module.exports = router;
