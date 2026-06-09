const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const asyncHandler = require("../utils/asyncHandler");
const ProductRequestController = require("../controllers/ProductRequestController");

const router = Router();
const auth = [authMiddleware];

router.post("/", ...auth, uploadAvatar.single("reference_image"), asyncHandler(ProductRequestController.create));
router.get("/me", ...auth, asyncHandler(ProductRequestController.listMine));
router.get("/me/sent", ...auth, asyncHandler(ProductRequestController.listMySent));
router.get("/me/chats", ...auth, asyncHandler(ProductRequestController.listMyChats));
router.get("/me/pro-chats", ...auth, asyncHandler(ProductRequestController.listMyProChats));
router.get("/mural", ...auth, asyncHandler(ProductRequestController.muralForProfile));
// Thread de mensagens (chat na O.S.) — antes de /:id para não ser engolido.
router.get("/responses/:id_response/messages", ...auth, asyncHandler(ProductRequestController.messages));
router.post("/responses/:id_response/messages", ...auth, asyncHandler(ProductRequestController.sendMessage));
router.post("/responses/:id_response/read", ...auth, asyncHandler(ProductRequestController.markRead));
router.get("/:id/eligible-products", ...auth, asyncHandler(ProductRequestController.eligibleProducts));
router.get("/:id/responses", ...auth, asyncHandler(ProductRequestController.listResponses));
router.post("/:id/responses", ...auth, asyncHandler(ProductRequestController.createResponse));
// Abre/reaproveita a conversa do vendedor (Responder do Mural, sem modal).
router.post("/:id/conversation", ...auth, asyncHandler(ProductRequestController.openConversation));
router.get("/:id", ...auth, asyncHandler(ProductRequestController.getById));
router.post("/:id/cancel", ...auth, asyncHandler(ProductRequestController.cancel));
router.post("/:id/close", ...auth, asyncHandler(ProductRequestController.close));
router.delete("/:id", ...auth, asyncHandler(ProductRequestController.hide));

module.exports = router;
