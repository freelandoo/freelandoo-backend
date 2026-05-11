const { Router } = require("express");
const CoursesController = require("../controllers/CoursesController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Tudo aqui exige autenticação — o owner é sempre req.user.
router.use(authMiddleware);

router.get("/", asyncHandler(CoursesController.listMine));
router.post("/", asyncHandler(CoursesController.create));
router.get("/:id", asyncHandler(CoursesController.getMineById));
router.put("/:id", asyncHandler(CoursesController.update));
router.delete("/:id", asyncHandler(CoursesController.remove));

module.exports = router;
