const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const PostReportController = require("../controllers/PostReportController");

const router = Router();

// Reportar um post — qualquer user logado.
router.post(
  "/portfolio/items/:id/report",
  authMiddleware,
  asyncHandler(PostReportController.report)
);

// Admin: listar / preview / ban / unban.
router.get(
  "/admin/posts",
  [authMiddleware, roleMiddleware("Administrator")],
  asyncHandler(PostReportController.adminList)
);
router.get(
  "/admin/posts/:id",
  [authMiddleware, roleMiddleware("Administrator")],
  asyncHandler(PostReportController.adminPreview)
);
router.post(
  "/admin/posts/:id/ban",
  [authMiddleware, roleMiddleware("Administrator")],
  asyncHandler(PostReportController.adminBan)
);
router.post(
  "/admin/posts/:id/unban",
  [authMiddleware, roleMiddleware("Administrator")],
  asyncHandler(PostReportController.adminUnban)
);

module.exports = router;
