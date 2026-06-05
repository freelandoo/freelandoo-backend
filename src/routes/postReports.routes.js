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
// Marca denúncias como resolvidas (sai do alerta, sem banir).
router.post(
  "/admin/posts/:id/resolve",
  [authMiddleware, roleMiddleware("Administrator")],
  asyncHandler(PostReportController.adminResolve)
);

// Modal de alerta do admin: posts denunciados pendentes + afiliados urgentes.
router.get(
  "/admin/alerts/summary",
  [authMiddleware, roleMiddleware("Administrator")],
  asyncHandler(PostReportController.alertSummary)
);

module.exports = router;
