// Bloqueio entre usuários e revisão de denúncias de DM (mig 283).
//
//   GET    /me/blocks                       quem eu bloqueei
//   POST   /me/blocks                       { target_profile_id }
//   GET    /me/blocks/:id_profile/status    { blocked_by_me }
//   DELETE /me/blocks/:id_profile
//   GET    /admin/message-reports?status=   (Administrator)
//   POST   /admin/message-reports/:id/resolve { decision: dismissed|actioned }
//
// A denúncia em si mora em conversation.routes (POST /conversations/messages/:id/report).

const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const { sendServiceResult } = require("../utils/sendServiceResult");
const rateLimit = require("../middlewares/rateLimit");
const SocialSafetyService = require("../services/SocialSafetyService");

const blocks = Router();
blocks.use(authMiddleware);
blocks.get("/", asyncHandler(async (req, res) => sendServiceResult(res, await SocialSafetyService.listMine(req.user))));
blocks.post(
  "/",
  rateLimit.lookup,
  asyncHandler(async (req, res) =>
    sendServiceResult(res, await SocialSafetyService.block(req.user, { target_profile_id: req.body?.target_profile_id }))
  )
);
blocks.get(
  "/:id_profile/status",
  asyncHandler(async (req, res) =>
    sendServiceResult(res, await SocialSafetyService.status(req.user, { target_profile_id: req.params.id_profile }))
  )
);
blocks.delete(
  "/:id_profile",
  asyncHandler(async (req, res) =>
    sendServiceResult(res, await SocialSafetyService.unblock(req.user, { target_profile_id: req.params.id_profile }))
  )
);

const adminReports = Router();
adminReports.use(authMiddleware, roleMiddleware("Administrator"));
adminReports.get(
  "/",
  asyncHandler(async (req, res) =>
    sendServiceResult(res, await SocialSafetyService.adminListReports({ status: req.query?.status, limit: req.query?.limit }))
  )
);
adminReports.post(
  "/:id/resolve",
  asyncHandler(async (req, res) =>
    sendServiceResult(
      res,
      await SocialSafetyService.adminResolve(req.user, { id_message_report: req.params.id, decision: req.body?.decision })
    )
  )
);

module.exports = { blocks, adminReports };
