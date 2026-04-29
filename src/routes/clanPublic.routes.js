const { Router } = require("express");
const ClanController = require("../controllers/ClanController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/", asyncHandler(ClanController.listPublic));

router.get("/:id_profile", asyncHandler(ClanController.getPublic));

module.exports = router;
