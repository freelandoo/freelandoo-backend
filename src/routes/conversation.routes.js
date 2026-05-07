const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const ConversationController = require("../controllers/ConversationController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Sumário de unread (badge no header). DEVE vir antes de "/:id".
router.get(
  "/unread-count",
  authMiddleware,
  asyncHandler(ConversationController.unread)
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
