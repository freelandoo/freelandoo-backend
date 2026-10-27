// src/routes/academyFeeAdmin.routes.js
// Repasses das mensalidades pagas pela Freelandoo (mig 310). O PIX é MANUAL:
// o admin vê a chave da academia, faz a transferência e marca pago aqui.
// Fora da flag `fitness_academias` de propósito: desligar o ambiente não pode
// esconder dinheiro que já é de alguém.
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const AcademyFeeController = require("../controllers/AcademyFeeController");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/", ...admin, asyncHandler(AcademyFeeController.adminList));
router.post("/:id_payout/paid", ...admin, asyncHandler(AcademyFeeController.adminMarkPaid));

module.exports = router;
