// src/routes/appLink.routes.js
//
// Vínculo do app nativo EVO Brazil (mig 278).
//
// ⚠️ As três portas ANÔNIMAS (exchange, refresh, logout) são chamadas pelo
// app, não pelo navegador: não há CORS a abrir. `exchange` tem o rate limit
// mais apertado da casa porque é a porta que adivinha código; `refresh` roda
// uma vez por abertura do app e tem limite folgado.

const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const rateLimit = require("../middlewares/rateLimit");
const AppLinkController = require("../controllers/AppLinkController");

const router = Router();

router.post(
  "/me/app-link-code",
  authMiddleware,
  rateLimit.auth,
  asyncHandler(AppLinkController.createCode)
);
router.get("/me/app-sessions", authMiddleware, asyncHandler(AppLinkController.listSessions));
router.delete(
  "/me/app-sessions/:id_app_session",
  authMiddleware,
  asyncHandler(AppLinkController.revokeSession)
);

router.post(
  "/app-link/exchange",
  rateLimit.appLinkExchange,
  asyncHandler(AppLinkController.exchange)
);
router.post("/app-link/refresh", rateLimit.lookup, asyncHandler(AppLinkController.refresh));
router.post("/app-link/logout", rateLimit.lookup, asyncHandler(AppLinkController.logout));

module.exports = router;
