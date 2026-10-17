// Freelandoo Arena — contrato em freelandoo-arena/docs/architecture/ARENA_API.md.
//
//   GET    /arena/catalog                       público (cache curto)
//   POST   /arena/session                       guard → inicializa/recupera o jogador
//   GET    /arena/me/preferences                guard
//   PUT    /arena/me/preferences/:categoryId    guard  { teamId, expectedRevision, activate? }
//   DELETE /arena/me/preferences/:categoryId    guard  { expectedRevision }
//   PUT    /arena/me/active                     guard  { categoryId | null, expectedRevision }
//   PUT    /arena/me/consents/:categoryId       guard  { policyVersion }
//   DELETE /arena/me/consents/:categoryId       guard
//
// A identidade SEMPRE vem do token (req.arena.id_user). Nenhuma rota aceita
// id_user, playerId ou e-mail no corpo ou na querystring.

const express = require("express");
const pool = require("../databases");
const asyncHandler = require("../utils/asyncHandler");
const { createArenaAuth } = require("../middlewares/arenaAuth");
const { arenaRead, arenaWrite } = require("../middlewares/rateLimit");
const ArenaService = require("../services/ArenaService");

const router = express.Router();
const arenaAuth = createArenaAuth({ pool });

// O json parser global aceita 1 MB; nenhuma operação da Arena passa de poucos
// bytes. Corpo grande é recusado antes de chegar ao service.
const MAX_BODY_BYTES = 2048;
function smallBody(req, res, next) {
  const len = Number(req.headers["content-length"] || 0);
  if (len > MAX_BODY_BYTES) return res.status(413).json({ error: "Corpo grande demais", code: "payload_too_large" });
  return next();
}

const send = (res, { status, body }) => res.status(status).json(body);

router.get(
  "/catalog",
  arenaRead,
  asyncHandler(async (req, res) => {
    // Catálogo não é pessoal: pode ficar na borda por pouco tempo.
    res.setHeader("Cache-Control", "public, max-age=60");
    return send(res, await ArenaService.getCatalog());
  })
);

router.post("/session", arenaRead, arenaAuth, asyncHandler(async (req, res) => send(res, await ArenaService.startSession(req.arena))));

router.get("/me/preferences", arenaRead, arenaAuth, asyncHandler(async (req, res) => send(res, await ArenaService.getPreferences(req.arena))));

router.put(
  "/me/preferences/:categoryId",
  arenaWrite,
  smallBody,
  arenaAuth,
  asyncHandler(async (req, res) => send(res, await ArenaService.savePreference(req.arena, req.params.categoryId, req.body)))
);

router.delete(
  "/me/preferences/:categoryId",
  arenaWrite,
  smallBody,
  arenaAuth,
  asyncHandler(async (req, res) => send(res, await ArenaService.removePreference(req.arena, req.params.categoryId, req.body)))
);

router.put("/me/active", arenaWrite, smallBody, arenaAuth, asyncHandler(async (req, res) => send(res, await ArenaService.setActive(req.arena, req.body))));

router.put(
  "/me/consents/:categoryId",
  arenaWrite,
  smallBody,
  arenaAuth,
  asyncHandler(async (req, res) => send(res, await ArenaService.grantConsent(req.arena, req.params.categoryId, req.body)))
);

router.delete(
  "/me/consents/:categoryId",
  arenaWrite,
  smallBody,
  arenaAuth,
  asyncHandler(async (req, res) => send(res, await ArenaService.revokeConsent(req.arena, req.params.categoryId)))
);

module.exports = router;
