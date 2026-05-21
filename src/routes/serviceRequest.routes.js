const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const ServiceRequestController = require("../controllers/ServiceRequestController");

const router = Router();
const auth = [authMiddleware];

// USER — minhas O.S.
router.post("/", ...auth, asyncHandler(ServiceRequestController.create));
router.get("/me", ...auth, asyncHandler(ServiceRequestController.listMine));
router.get("/me/chats", ...auth, asyncHandler(ServiceRequestController.listMyChats));
router.get("/me/pro-chats", ...auth, asyncHandler(ServiceRequestController.listMyProChats));
router.post("/:id/cancel", ...auth, asyncHandler(ServiceRequestController.cancel));
router.delete("/:id", ...auth, asyncHandler(ServiceRequestController.hide));
router.post("/:id/finalize-response/:id_response", ...auth, asyncHandler(ServiceRequestController.finalize));
router.post("/:id/reject-response/:id_response", ...auth, asyncHandler(ServiceRequestController.userReject));
router.get("/badge/me", ...auth, asyncHandler(ServiceRequestController.badgeMe));

// PRO — mural do subperfil
router.get("/mural", ...auth, asyncHandler(ServiceRequestController.mural));
router.post("/mural/mark-seen", ...auth, asyncHandler(ServiceRequestController.markSeen));
router.post("/:id/respond", ...auth, asyncHandler(ServiceRequestController.respond));
router.get("/badge", ...auth, asyncHandler(ServiceRequestController.badgeProfile));

// Chat
router.post("/responses/:id_response/read", ...auth, asyncHandler(ServiceRequestController.markRead));
router.get("/responses/:id_response/messages", ...auth, asyncHandler(ServiceRequestController.messages));
router.post("/responses/:id_response/messages", ...auth, asyncHandler(ServiceRequestController.sendMessage));
// Apaga a conversa (soft-delete em tb_service_request_response). Some pros 2 lados.
router.delete("/responses/:id_response", ...auth, asyncHandler(ServiceRequestController.deleteChat));

module.exports = router;
