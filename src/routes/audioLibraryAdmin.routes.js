const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const uploadAudioTrack = require("../middlewares/uploadAudioTrack");
const AudioTrackController = require("../controllers/AudioTrackController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/", ...admin, asyncHandler(AudioTrackController.adminList));
router.get("/:id", ...admin, asyncHandler(AudioTrackController.adminGet));
router.post("/", ...admin, uploadAudioTrack, asyncHandler(AudioTrackController.adminCreate));
router.put("/:id", ...admin, uploadAudioTrack, asyncHandler(AudioTrackController.adminUpdate));
router.delete("/:id", ...admin, asyncHandler(AudioTrackController.adminRemove));

module.exports = router;
