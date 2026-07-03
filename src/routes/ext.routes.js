// src/routes/ext.routes.js
// API externa de atendimento (/ext/v1). Auth por token de conexão, NÃO JWT.
const { Router } = require("express");
const requireFeature = require("../middlewares/requireFeature");
const apiConnectionAuth = require("../middlewares/apiConnectionAuth");
const requireConnectionKind = require("../middlewares/requireConnectionKind");
const extRateLimit = require("../middlewares/extRateLimit");
const ExtMessagingController = require("../controllers/ExtMessagingController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(requireFeature("atendimento_api"));
router.use(apiConnectionAuth);
router.use(requireConnectionKind("atendimento"));
router.use(extRateLimit);

router.get("/me", asyncHandler(ExtMessagingController.me));
router.post("/webhook", asyncHandler(ExtMessagingController.setWebhook));
router.get("/conversations", asyncHandler(ExtMessagingController.listConversations));
router.get("/conversations/:id/messages", asyncHandler(ExtMessagingController.listMessages));
router.post("/conversations/:id/messages", asyncHandler(ExtMessagingController.sendMessage));
router.post("/conversations/:id/read", asyncHandler(ExtMessagingController.markRead));

module.exports = router;
