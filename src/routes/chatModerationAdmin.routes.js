const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const ChatModerationAdminController = require("../controllers/ChatModerationAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const guard = [authMiddleware, roleMiddleware("Administrator")];

// blocked_terms
router.get("/blocked-terms",                guard, asyncHandler(ChatModerationAdminController.listTerms));
router.post("/blocked-terms",               guard, asyncHandler(ChatModerationAdminController.createTerm));
router.patch("/blocked-terms/:id_blocked_term", guard, asyncHandler(ChatModerationAdminController.updateTerm));
router.delete("/blocked-terms/:id_blocked_term", guard, asyncHandler(ChatModerationAdminController.deleteTerm));

// settings
router.get("/chat-moderation/settings",                 guard, asyncHandler(ChatModerationAdminController.getSettings));
router.patch("/chat-moderation/settings/:room_type",    guard, asyncHandler(ChatModerationAdminController.updateSettings));

// fila de revisão / resultados
router.get("/chat-moderation/results",                  guard, asyncHandler(ChatModerationAdminController.listResults));
router.post("/chat-moderation/results/:id_moderation_result/approve",     guard, asyncHandler(ChatModerationAdminController.approveResult));
router.post("/chat-moderation/results/:id_moderation_result/keep-blocked", guard, asyncHandler(ChatModerationAdminController.keepBlockedResult));

// ações sobre o user
router.get("/chat-moderation/users/:id_user",                   guard, asyncHandler(ChatModerationAdminController.getUserState));
router.post("/chat-moderation/users/:id_user/mute",             guard, asyncHandler(ChatModerationAdminController.muteUser));
router.post("/chat-moderation/users/:id_user/ban",              guard, asyncHandler(ChatModerationAdminController.banUser));
router.post("/chat-moderation/users/:id_user/clear-penalties",  guard, asyncHandler(ChatModerationAdminController.clearPenalties));

// ocultar / restaurar mensagem
router.post("/chat-moderation/messages/:id_chat_message/hide",   guard, asyncHandler(ChatModerationAdminController.hideMessage));
router.post("/chat-moderation/messages/:id_chat_message/unhide", guard, asyncHandler(ChatModerationAdminController.unhideMessage));

// Reset manual: apaga TODO o histórico do Chat ao Vivo (Global + Máquinas).
// Mesmo job que roda automaticamente toda meia-noite SP.
router.post("/chat-moderation/daily-reset", guard, asyncHandler(async (req, res) => {
  const pool = require("../databases");
  const ChatStorage = require("../storages/ChatStorage");
  const { createLogger } = require("../utils/logger");
  const log = createLogger("admin.chat_reset");
  try {
    const counts = await ChatStorage.dailyReset(pool);
    log.info("manual_reset", { admin_user: req.user?.id_user, counts });
    return res.json({ ok: true, deleted: counts });
  } catch (err) {
    log.error("manual_reset_error", { message: err.message });
    return res.status(500).json({ error: err.message });
  }
}));

module.exports = router;
