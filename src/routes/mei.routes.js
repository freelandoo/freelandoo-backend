const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const MeiController = require("../controllers/MeiController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Camada MEI/Recibo da Carteira (todas autenticadas, escopo do user logado).
router.get("/me/mei/overview", authMiddleware, asyncHandler(MeiController.overview));
router.put("/me/mei/profile", authMiddleware, asyncHandler(MeiController.saveProfile));
router.get("/me/mei/receipts", authMiddleware, asyncHandler(MeiController.listReceipts));
router.post("/me/mei/receipts", authMiddleware, asyncHandler(MeiController.createReceipt));
router.get("/me/mei/receipts/:id", authMiddleware, asyncHandler(MeiController.getReceipt));

module.exports = router;
