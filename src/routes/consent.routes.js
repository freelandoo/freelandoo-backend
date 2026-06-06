const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const ConsentController = require("../controllers/ConsentController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(authMiddleware);
router.get("/", asyncHandler(ConsentController.listMine));
router.post("/", asyncHandler(ConsentController.accept));

module.exports = router;
