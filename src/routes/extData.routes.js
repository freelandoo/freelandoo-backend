// src/routes/extData.routes.js
// API externa de DADOS (/ext/v1/data). Somente-leitura. Auth por token de
// conexão kind='data' (flnd_data_), NÃO JWT. Gate próprio: data_api.
const { Router } = require("express");
const requireFeature = require("../middlewares/requireFeature");
const apiConnectionAuth = require("../middlewares/apiConnectionAuth");
const requireConnectionKind = require("../middlewares/requireConnectionKind");
const extRateLimit = require("../middlewares/extRateLimit");
const DataExportController = require("../controllers/DataExportController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(requireFeature("data_api"));
router.use(apiConnectionAuth);
router.use(requireConnectionKind("data"));
router.use(extRateLimit);

router.get("/me", asyncHandler(DataExportController.me));
router.get("/profiles", asyncHandler(DataExportController.profiles));
router.get("/services", asyncHandler(DataExportController.services));
router.get("/products", asyncHandler(DataExportController.products));
router.get("/social", asyncHandler(DataExportController.social));
router.get("/courses", asyncHandler(DataExportController.courses));
router.get("/metrics", asyncHandler(DataExportController.metrics));

module.exports = router;
