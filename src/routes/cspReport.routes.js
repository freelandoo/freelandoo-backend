// src/routes/cspReport.routes.js — Segurança A4 (CSP): o navegador manda as violações da CSP para
// POST /csp-report (sem login: quem manda é o navegador do visitante); o admin lê em
// GET /admin/csp-reports. Corpo pequeno (16 KB), e o teto global por IP já vale (rateLimit.global).
const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const CspReportService = require("../services/CspReportService");

const report = express.Router();
report.post(
  "/",
  express.json({ type: ["application/csp-report", "application/reports+json", "application/json"], limit: "16kb" }),
  asyncHandler(async (req, res) => {
    try {
      await CspReportService.record(req.body);
    } catch {
      /* relatório nunca derruba nada */
    }
    // 204 sempre: o navegador não lê a resposta
    res.status(204).end();
  })
);

const admin = express.Router();
admin.get(
  "/",
  authMiddleware,
  roleMiddleware("Administrator"),
  asyncHandler(async (req, res) => res.json(await CspReportService.listAdmin({ days: req.query.days })))
);

module.exports = { report, admin };
