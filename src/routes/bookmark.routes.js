const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const BookmarkController = require("../controllers/BookmarkController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(authMiddleware);
router.get("/folders", asyncHandler(BookmarkController.listFolders));
router.post("/folders", asyncHandler(BookmarkController.createFolder));
router.get("/status", asyncHandler(BookmarkController.status));
router.post("/toggle", asyncHandler(BookmarkController.toggle));
router.get("/", asyncHandler(BookmarkController.listMine));

module.exports = router;
