// src/routes/vitrines.routes.js
//
// A2 + A4 (mig 338):
//   /me/needs                         chaves "emprego" / "dívidas" da pessoa
//   /communities/:id/jobs | /debts    abas Empregos e Dívidas (toda comunidade)
//   /debts/*                          feed nacional de boletos
//   /admin/debts/*                    moderação
//
// ⚠️ ROTAS ESTÁTICAS ANTES DE `/:id_bill` (settings, mine) — senão a palavra
// vira o id de um boleto.
//
// ⚠️ SAÍDAS SEM GATE: retirar boleto, soltar reserva e desligar a chave
// passam sempre, pela regra de sempre (porta de saída trancada não existe).

const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const uploadProof = require("../middlewares/uploadAccountingReceipt");
const rateLimit = require("../middlewares/rateLimit");
const asyncHandler = require("../utils/asyncHandler");
const C = require("../controllers/VitrineController");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

/* chaves da pessoa */
router.get("/me/needs", authMiddleware, asyncHandler(C.needs));
router.put("/me/needs", authMiddleware, asyncHandler(C.updateNeeds));

/* abas da comunidade */
router.get("/communities/:id_profile/jobs", authMiddleware, asyncHandler(C.communityJobs));
router.get("/communities/:id_profile/debts", authMiddleware, asyncHandler(C.communityDebts));

/* feed de boletos */
router.get("/debts/settings", authMiddleware, asyncHandler(C.debtSettings));
router.get("/debts/mine", authMiddleware, asyncHandler(C.debtMine));
router.get("/debts", authMiddleware, asyncHandler(C.debtFeed));
router.post("/debts", authMiddleware, rateLimit.lookup, asyncHandler(C.debtCreate));
router.post("/debts/:id_bill/cancel", authMiddleware, asyncHandler(C.debtCancel));
router.post("/debts/:id_bill/reserve", authMiddleware, asyncHandler(C.debtReserve));
router.delete("/debts/:id_bill/reserve", authMiddleware, asyncHandler(C.debtRelease));
router.post(
  "/debts/:id_bill/proof",
  authMiddleware,
  rateLimit.upload,
  uploadProof.single("file"),
  asyncHandler(C.debtProof)
);
router.get("/debts/:id_bill/proof-url", authMiddleware, asyncHandler(C.debtProofUrl));
router.post("/debts/:id_bill/confirm", authMiddleware, asyncHandler(C.debtConfirm));
router.post("/debts/:id_bill/reject-proof", authMiddleware, asyncHandler(C.debtRejectProof));
router.post("/debts/:id_bill/report", authMiddleware, asyncHandler(C.debtReport));

/* moderação */
router.get("/admin/debts/queue", ...admin, asyncHandler(C.adminQueue));
router.get("/admin/debts/settings", ...admin, asyncHandler(C.adminSettings));
router.put("/admin/debts/settings", ...admin, asyncHandler(C.adminUpdateSettings));
router.post("/admin/debts/:id_bill/review", ...admin, asyncHandler(C.adminReview));
router.post("/admin/debts/:id_bill/remove", ...admin, asyncHandler(C.adminRemove));
router.post("/admin/debts/:id_bill/resolve-reports", ...admin, asyncHandler(C.adminResolveReports));
router.get("/admin/debts/:id_bill/proof-url", ...admin, asyncHandler(C.adminProofUrl));

module.exports = router;
