// src/routes/dataApiConnection.routes.js
// Gestão das conexões de API de DADOS (token flnd_data_) — JWT normal do site.
// Reusa o ApiConnectionController forçando kind='data'. Gate próprio: data_api.
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const ApiConnectionController = require("../controllers/ApiConnectionController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(requireFeature("data_api"));
router.use((req, _res, next) => {
  req.connectionKind = "data";
  next();
});

router.get("/", authMiddleware, asyncHandler(ApiConnectionController.list));
router.post("/", authMiddleware, asyncHandler(ApiConnectionController.create));
router.post("/:id/revoke", authMiddleware, asyncHandler(ApiConnectionController.revoke));

module.exports = router;
