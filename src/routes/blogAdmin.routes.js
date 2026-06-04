const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const BlogAdminController = require("../controllers/BlogAdminController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/posts", ...admin, asyncHandler(BlogAdminController.list));
router.get("/posts/:id", ...admin, asyncHandler(BlogAdminController.get));
router.post("/posts", ...admin, uploadAvatar.single("cover"), asyncHandler(BlogAdminController.create));
router.put("/posts/:id", ...admin, uploadAvatar.single("cover"), asyncHandler(BlogAdminController.update));
router.delete("/posts/:id", ...admin, asyncHandler(BlogAdminController.remove));
router.post("/uploads/cover", ...admin, uploadAvatar.single("cover"), asyncHandler(BlogAdminController.uploadCover));

module.exports = router;
