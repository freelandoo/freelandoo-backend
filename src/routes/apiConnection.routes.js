// src/routes/apiConnection.routes.js
// Gestão das conexões de API (token do atendimento) — JWT normal do site.
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const ApiConnectionController = require("../controllers/ApiConnectionController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(requireFeature("atendimento_api"));

router.get("/", authMiddleware, asyncHandler(ApiConnectionController.list));
router.post("/", authMiddleware, asyncHandler(ApiConnectionController.create));
router.post("/:id/revoke", authMiddleware, asyncHandler(ApiConnectionController.revoke));

module.exports = router;
