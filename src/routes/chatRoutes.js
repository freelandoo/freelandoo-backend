"use strict";

const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const ChatController = require("../controllers/ChatController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(authMiddleware);

router.get("/machines", asyncHandler(ChatController.machines));
router.post("/join", asyncHandler(ChatController.join));

router.post("/rooms/:id_chat_room/heartbeat", asyncHandler(ChatController.heartbeat));
router.post("/rooms/:id_chat_room/leave", asyncHandler(ChatController.leave));

router.get("/rooms/:id_chat_room/messages", asyncHandler(ChatController.listMessages));
router.post("/rooms/:id_chat_room/messages", asyncHandler(ChatController.sendMessage));

router.delete("/messages/:id_chat_message", asyncHandler(ChatController.deleteOwnMessage));
router.post("/messages/:id_chat_message/report", asyncHandler(ChatController.reportMessage));

module.exports = router;
