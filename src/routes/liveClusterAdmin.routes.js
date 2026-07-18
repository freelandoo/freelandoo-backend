const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const LiveClusterAdminController = require("../controllers/LiveClusterAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

// Clusters de Live — sala de comando do admin (sem gate de flag: kill-switch
// da flag live_clusters só esconde a superfície do MEMBRO).
router.get("/", ...admin, asyncHandler(LiveClusterAdminController.list));
router.post("/", ...admin, asyncHandler(LiveClusterAdminController.create));
router.get("/:id_live_cluster", ...admin, asyncHandler(LiveClusterAdminController.detail));
router.put("/:id_live_cluster", ...admin, asyncHandler(LiveClusterAdminController.update));
router.delete("/:id_live_cluster", ...admin, asyncHandler(LiveClusterAdminController.remove));

router.post("/:id_live_cluster/members", ...admin, asyncHandler(LiveClusterAdminController.addMember));
router.delete("/:id_live_cluster/members/:id_user", ...admin, asyncHandler(LiveClusterAdminController.removeMember));

router.post("/:id_live_cluster/buttons", ...admin, asyncHandler(LiveClusterAdminController.createButton));
router.put("/:id_live_cluster/buttons/:id_button", ...admin, asyncHandler(LiveClusterAdminController.updateButton));
router.delete("/:id_live_cluster/buttons/:id_button", ...admin, asyncHandler(LiveClusterAdminController.removeButton));

router.post("/:id_live_cluster/start", ...admin, asyncHandler(LiveClusterAdminController.start));
router.post("/:id_live_cluster/end", ...admin, asyncHandler(LiveClusterAdminController.end));
router.post("/:id_live_cluster/signal", ...admin, asyncHandler(LiveClusterAdminController.signal));

module.exports = router;
