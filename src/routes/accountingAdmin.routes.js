const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const uploadAccountingReceipt = require("../middlewares/uploadAccountingReceipt");
const C = require("../controllers/AccountingAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Painel de Contabilidade dos admins (mig 277). Sem feature flag: painel de
// admin é sempre acessível (convenção do painel de fraude e dos clusters).
// As rotas literais (/selic, /companies) vêm antes das com parâmetro.
router.get("/selic", ...admin, asyncHandler(C.listSelic));
router.put("/selic", ...admin, asyncHandler(C.upsertSelic));
router.delete("/selic/:month", ...admin, asyncHandler(C.deleteSelic));

router.get("/companies", ...admin, asyncHandler(C.listCompanies));
router.post("/companies", ...admin, asyncHandler(C.createCompany));
router.put("/companies/:id_company", ...admin, asyncHandler(C.updateCompany));
router.delete("/companies/:id_company", ...admin, asyncHandler(C.deleteCompany));

router.get("/companies/:id_company/dashboard", ...admin, asyncHandler(C.dashboard));
router.get("/companies/:id_company/das", ...admin, asyncHandler(C.estimateDas));

router.get("/companies/:id_company/entries", ...admin, asyncHandler(C.listEntries));
router.post("/companies/:id_company/entries", ...admin, asyncHandler(C.createEntry));
router.put("/companies/:id_company/entries/:id_entry", ...admin, asyncHandler(C.updateEntry));
router.delete("/companies/:id_company/entries/:id_entry", ...admin, asyncHandler(C.deleteEntry));

router.get("/companies/:id_company/obligations", ...admin, asyncHandler(C.listObligations));
router.post("/companies/:id_company/obligations", ...admin, asyncHandler(C.createObligation));
router.post("/companies/:id_company/obligations/generate", ...admin, asyncHandler(C.generateCalendar));
router.put("/companies/:id_company/obligations/:id_obligation", ...admin, asyncHandler(C.updateObligation));
router.post("/companies/:id_company/obligations/:id_obligation/status", ...admin, asyncHandler(C.setStatus));
router.delete("/companies/:id_company/obligations/:id_obligation", ...admin, asyncHandler(C.deleteObligation));
router.post(
  "/companies/:id_company/obligations/:id_obligation/receipt",
  ...admin,
  uploadAccountingReceipt.single("file"),
  asyncHandler(C.uploadReceipt),
);
router.get("/companies/:id_company/obligations/:id_obligation/receipt", ...admin, asyncHandler(C.receiptUrl));

module.exports = router;
