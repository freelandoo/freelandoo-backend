const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const ClanController = require("../controllers/ClanController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get(
  "/eligibility",
  authMiddleware,
  asyncHandler(ClanController.getCreationEligibility)
);

router.get("/me", authMiddleware, asyncHandler(ClanController.listMine));

router.get(
  "/invites/me",
  authMiddleware,
  asyncHandler(ClanController.listMyInvites)
);

router.get(
  "/invitable",
  authMiddleware,
  asyncHandler(ClanController.findInvitableProfiles)
);

router.post(
  "/invites/:id_clan_invite/respond",
  authMiddleware,
  asyncHandler(ClanController.respondInvite)
);

router.delete(
  "/invites/:id_clan_invite",
  authMiddleware,
  asyncHandler(ClanController.cancelInvite)
);

router.post("/", authMiddleware, asyncHandler(ClanController.create));

router.get("/:id_profile", asyncHandler(ClanController.getById));

router.post(
  "/:id_profile/invites",
  authMiddleware,
  asyncHandler(ClanController.invite)
);

router.get(
  "/:id_profile/invites",
  authMiddleware,
  asyncHandler(ClanController.listInvitesByClan)
);

router.delete(
  "/:id_profile/members/:id_member_profile",
  authMiddleware,
  asyncHandler(ClanController.removeMember)
);

router.get(
  "/:id_profile/messages",
  authMiddleware,
  asyncHandler(ClanController.listMessages)
);

router.post(
  "/:id_profile/messages",
  authMiddleware,
  asyncHandler(ClanController.postMessage)
);

router.delete(
  "/messages/:id_clan_message",
  authMiddleware,
  asyncHandler(ClanController.deleteMessage)
);

router.post(
  "/:id_profile/slots/checkout",
  authMiddleware,
  asyncHandler(ClanController.createSlotCheckout)
);

router.get(
  "/:id_profile/slots/purchases",
  authMiddleware,
  asyncHandler(ClanController.listSlotPurchases)
);

module.exports = router;
