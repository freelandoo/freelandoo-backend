const { Router } = require("express");
const CoursesController = require("../controllers/CoursesController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const courseModulesRoutes = require("./courseModules.routes");

const router = Router();

// Tudo aqui exige autenticação — o owner é sempre req.user.
router.use(authMiddleware);

// Recursos aninhados (Slice 4: módulos). Renomeia :id -> :courseId no nested.
router.use("/:courseId/modules", courseModulesRoutes);

router.get("/", asyncHandler(CoursesController.listMine));
router.post("/", asyncHandler(CoursesController.create));
router.get("/:id", asyncHandler(CoursesController.getMineById));
router.put("/:id", asyncHandler(CoursesController.update));
router.delete("/:id", asyncHandler(CoursesController.remove));

module.exports = router;
