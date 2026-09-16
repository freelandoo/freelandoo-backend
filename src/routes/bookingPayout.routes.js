const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const BookingPayoutController = require("../controllers/BookingPayoutController");
const CommunityDeliveryController = require("../controllers/CommunityDeliveryController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/me/booking-payouts", authMiddleware, asyncHandler(BookingPayoutController.listMine));

// O que a pessoa ganhou ENTREGANDO para os vizinhos (mig 248).
//
// ⚠️ Mora aqui e não em `/communities/:id/...` porque o saldo é DA PESSOA, não
// da comunidade: quem entrega em dois lugares (o prédio e a rua) tem uma
// carteira só, e pendurar o repasse na comunidade obrigaria a tela a somar N
// respostas para dizer quanto ele tem.
router.get(
  "/me/delivery-payouts",
  authMiddleware,
  asyncHandler(CommunityDeliveryController.myPayouts)
);

router.get(
  "/admin/booking-payouts",
  [authMiddleware, roleMiddleware("Administrator")],
  asyncHandler(BookingPayoutController.listAdmin)
);

router.post(
  "/admin/booking-payouts/:id_payout/mark-paid",
  [authMiddleware, roleMiddleware("Administrator")],
  asyncHandler(BookingPayoutController.markPaidOut)
);

module.exports = router;
