const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const CourseRequestController = require("../controllers/CourseRequestController");

const router = Router();
const auth = [authMiddleware];

// USER side
router.post("/", ...auth, asyncHandler(CourseRequestController.create));
router.get("/me", ...auth, asyncHandler(CourseRequestController.listMine));
router.get("/me/chats", ...auth, asyncHandler(CourseRequestController.listMyChats));
router.get("/me/pro-chats", ...auth, asyncHandler(CourseRequestController.listMyProChats));
router.post("/:id/cancel", ...auth, asyncHandler(CourseRequestController.cancel));

// PRO side
router.get("/mural", ...auth, asyncHandler(CourseRequestController.mural));
router.post("/mural/mark-seen", ...auth, asyncHandler(CourseRequestController.markMuralSeen));
router.get("/badge", ...auth, asyncHandler(CourseRequestController.badgeProfile));
router.get("/badge/me", ...auth, asyncHandler(CourseRequestController.badgeMe));
router.post("/:id/respond", ...auth, asyncHandler(CourseRequestController.respond));

// Mensagens
router.get("/responses/:id_response/messages", ...auth, asyncHandler(CourseRequestController.messages));
router.post("/responses/:id_response/messages", ...auth, asyncHandler(CourseRequestController.sendMessage));
router.post("/responses/:id_response/read", ...auth, asyncHandler(CourseRequestController.markRead));

module.exports = router;
