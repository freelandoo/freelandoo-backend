const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const ConversationController = require("../controllers/ConversationController");
const GroupConversationController = require("../controllers/GroupConversationController");
const uploadConversationAudio = require("../middlewares/uploadConversationAudio");
const asyncHandler = require("../utils/asyncHandler");
const rateLimit = require("../middlewares/rateLimit");
const { sendServiceResult } = require("../utils/sendServiceResult");
const SocialSafetyService = require("../services/SocialSafetyService");

const router = Router();

// Sumário de unread (badge no header). DEVE vir antes de "/:id".
router.get(
  "/unread-count",
  authMiddleware,
  asyncHandler(ConversationController.unread)
);

// Busca de perfis/clans pra começar nova conversa. DEVE vir antes de "/:id".
router.get(
  "/search",
  authMiddleware,
  asyncHandler(ConversationController.search)
);

// Grupos — rotas estáticas antes de "/:id".
router.post(
  "/groups",
  authMiddleware,
  asyncHandler(GroupConversationController.create)
);
router.get(
  "/groups/:id/members",
  authMiddleware,
  asyncHandler(GroupConversationController.listMembers)
);
router.post(
  "/groups/:id/members",
  authMiddleware,
  asyncHandler(GroupConversationController.addMembers)
);
router.post(
  "/groups/:id/leave",
  authMiddleware,
  asyncHandler(GroupConversationController.leave)
);

router.get("/", authMiddleware, asyncHandler(ConversationController.list));
router.post("/", authMiddleware, asyncHandler(ConversationController.open));

router.get("/:id", authMiddleware, asyncHandler(ConversationController.detail));

// Apagar conversa inteira (soft-delete em tb_conversation). Quem é dono de
// qualquer um dos dois participantes pode disparar — esconde dos dois lados.
router.delete(
  "/:id",
  authMiddleware,
  asyncHandler(ConversationController.deleteConversation)
);

router.get(
  "/:id/messages",
  authMiddleware,
  asyncHandler(ConversationController.listMessages)
);
router.post(
  "/:id/messages",
  authMiddleware,
  asyncHandler(ConversationController.sendMessage)
);

// Áudio — só em conversas privadas 1-a-1 (service rejeita group/global/maquinas).
router.post(
  "/:id/messages/audio",
  authMiddleware,
  uploadConversationAudio.single("audio"),
  asyncHandler(ConversationController.sendAudioMessage)
);

// Denúncia de mensagem direta (mig 283) — só participante, nunca a própria.
router.post(
  "/messages/:id_message/report",
  authMiddleware,
  rateLimit.lookup,
  asyncHandler(async (req, res) =>
    sendServiceResult(
      res,
      await SocialSafetyService.reportMessage(req.user, {
        id_message: req.params.id_message,
        reason_category: req.body?.reason_category,
        reason: req.body?.reason,
      }),
      201
    )
  )
);

// Apagar mensagem (autor) — limpa R2 best-effort se for áudio.
router.delete(
  "/messages/:id_message",
  authMiddleware,
  asyncHandler(ConversationController.deleteMessage)
);

router.post(
  "/:id/read",
  authMiddleware,
  asyncHandler(ConversationController.markRead)
);

module.exports = router;
