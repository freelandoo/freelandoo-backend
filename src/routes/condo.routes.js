const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const CondoController = require("../controllers/CondoController");
const asyncHandler = require("../utils/asyncHandler");

// Tudo aqui é área interna do condomínio: exige login E a flag `condominio`
// (kill-switch do Painel de Controle). Nenhuma rota é pública — o que é
// público do condomínio (nome, bairro/cidade) sai pelas rotas de comunidade.
const router = Router();

router.use(authMiddleware, requireFeature("condominio"));

// Fila do modal de enquete — ANTES de /:id_condo, senão é capturada por ele.
router.get("/polls/pending", asyncHandler(CondoController.listPendingPolls));

/* -------------------------------- estrutura ------------------------------- */
router.get("/:id_condo/structure", asyncHandler(CondoController.getStructure));
router.patch("/:id_condo/address", asyncHandler(CondoController.updateAddress));
router.post("/:id_condo/blocks", asyncHandler(CondoController.createBlock));
router.delete("/:id_condo/blocks/:id_block", asyncHandler(CondoController.deleteBlock));
router.post("/:id_condo/units", asyncHandler(CondoController.createUnit));
router.post("/:id_condo/parking", asyncHandler(CondoController.createSpot));

/* ----------------------------- reivindicações ----------------------------- */
router.post("/:id_condo/claims/unit", asyncHandler(CondoController.claimUnit));
router.post("/:id_condo/claims/parking", asyncHandler(CondoController.claimParking));
router.get("/:id_condo/claims", asyncHandler(CondoController.listClaims));
router.get("/:id_condo/claims/mine", asyncHandler(CondoController.listMyClaims));
router.post("/:id_condo/claims/:id_claim/decide", asyncHandler(CondoController.decideClaim));
router.post("/:id_condo/release", asyncHandler(CondoController.release));

/* --------------------------------- avisos --------------------------------- */
router.get("/:id_condo/notices", asyncHandler(CondoController.listNotices));
router.post("/:id_condo/notices", asyncHandler(CondoController.createNotice));
router.post("/:id_condo/notices/:id_notice/read", asyncHandler(CondoController.markNoticeRead));
router.patch("/:id_condo/notices/:id_notice/pin", asyncHandler(CondoController.pinNotice));
router.delete("/:id_condo/notices/:id_notice", asyncHandler(CondoController.deleteNotice));

/* -------------------------------- anúncios -------------------------------- */
// /listings/quota antes de /listings/:id_listing (rota estática vence a param).
router.get("/:id_condo/listings/quota", asyncHandler(CondoController.getQuota));
router.get("/:id_condo/listings", asyncHandler(CondoController.listListings));
router.post("/:id_condo/listings", asyncHandler(CondoController.createListing));
router.patch("/:id_condo/listings/:id_listing", asyncHandler(CondoController.updateListing));
router.patch("/:id_condo/listings/:id_listing/status", asyncHandler(CondoController.setListingStatus));

// Vagas de publicação: dinheiro (Stripe) ou Poléns.
router.post("/:id_condo/listing-slots/checkout", asyncHandler(CondoController.createSlotCheckout));
router.post("/:id_condo/listing-slots/polens", asyncHandler(CondoController.purchaseSlotWithPolens));

/* -------------------------------- enquetes -------------------------------- */
router.get("/:id_condo/polls", asyncHandler(CondoController.listPolls));
router.post("/:id_condo/polls", asyncHandler(CondoController.createPoll));
router.post("/:id_condo/polls/:id_poll/vote", asyncHandler(CondoController.votePoll));
router.post("/:id_condo/polls/:id_poll/close", asyncHandler(CondoController.closePoll));

module.exports = router;
