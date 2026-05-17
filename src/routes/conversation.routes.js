const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const ConversationController = require("../controllers/ConversationController");
const GroupConversationController = require("../controllers/GroupConversationController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Sumário de unread (badge no header). DEVE vir antes de "/:id".
router.get(
  "/unread-count",
  authMiddleware,
  asyncHandler(ConversationController.unread)
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

router.post(
  "/:id/read",
  authMiddleware,
  asyncHandler(ConversationController.markRead)
);

module.exports = router;
