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
// Canal INTERNO (servidor de jogo → backend, M06/M07). Exige assinatura do
// serviço (arenaServiceAuth) — o navegador não tem o segredo:
//   POST   /arena/internal/session              serviço + guard → mesma resposta de /session
//   POST   /arena/internal/checkpoints          serviço + guard → checkpoint (posição atestada)
//   GET    /arena/internal/territory            serviço → feed agregado por revisão
//
// A identidade SEMPRE vem do token (req.arena.id_user). Nenhuma rota aceita
// id_user, playerId ou e-mail no corpo ou na querystring.

const express = require("express");
const pool = require("../databases");
const asyncHandler = require("../utils/asyncHandler");
const { createArenaAuth } = require("../middlewares/arenaAuth");
const { arenaRead, arenaWrite, arenaInternal } = require("../middlewares/rateLimit");
const { createArenaServiceAuth } = require("../middlewares/arenaServiceAuth");
const ArenaService = require("../services/ArenaService");
const ArenaTerritoryService = require("../services/ArenaTerritoryService");
const ArenaSocialService = require("../services/ArenaSocialService");
const ArenaStatsService = require("../services/ArenaStatsService");
const ArenaPresenceService = require("../services/ArenaPresenceService");

const router = express.Router();
const arenaAuth = createArenaAuth({ pool });
const arenaService = createArenaServiceAuth();

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

// ─── Social (Módulo 09) ─────────────────────────────────────────────────────
// Fachada sobre a MESMA mensageria da Freelandoo (ArenaSocialService). Corpo
// de mensagem chega a 4000 caracteres: limite próprio, ainda pequeno.
const MAX_SOCIAL_BODY = 16 * 1024;
function socialBody(req, res, next) {
  const len = Number(req.headers["content-length"] || 0);
  if (len > MAX_SOCIAL_BODY) return res.status(413).json({ error: "Corpo grande demais", code: "payload_too_large" });
  return next();
}
const social = (fn) => asyncHandler(async (req, res) => send(res, await fn(req)));

router.get("/social/actors", arenaRead, arenaAuth, social((req) => ArenaSocialService.actors(req.arena)));
router.get("/social/conversations", arenaRead, arenaAuth, social((req) => ArenaSocialService.conversations(req.arena, req.query)));
router.get(
  "/social/conversations/:id/messages",
  arenaRead,
  arenaAuth,
  social((req) => ArenaSocialService.messages(req.arena, req.params.id, req.query))
);
router.post(
  "/social/conversations/:id/messages",
  arenaWrite,
  socialBody,
  arenaAuth,
  social((req) => ArenaSocialService.send(req.arena, req.params.id, req.body))
);
router.post(
  "/social/conversations/:id/read",
  arenaWrite,
  smallBody,
  arenaAuth,
  social((req) => ArenaSocialService.read(req.arena, req.params.id, req.body))
);
router.get("/social/players/:playerId", arenaRead, arenaAuth, social((req) => ArenaSocialService.player(req.arena, req.params.playerId)));
router.post(
  "/social/players/:playerId/conversation",
  arenaWrite,
  smallBody,
  arenaAuth,
  social((req) => ArenaSocialService.openWithPlayer(req.arena, req.params.playerId, req.body))
);
router.put("/social/players/:playerId/block", arenaWrite, arenaAuth, social((req) => ArenaSocialService.block(req.arena, req.params.playerId, true)));
router.delete("/social/players/:playerId/block", arenaWrite, arenaAuth, social((req) => ArenaSocialService.block(req.arena, req.params.playerId, false)));
router.put("/social/players/:playerId/follow", arenaWrite, arenaAuth, social((req) => ArenaSocialService.follow(req.arena, req.params.playerId, true)));
router.delete("/social/players/:playerId/follow", arenaWrite, arenaAuth, social((req) => ArenaSocialService.follow(req.arena, req.params.playerId, false)));
router.post(
  "/social/messages/:id/report",
  arenaWrite,
  smallBody,
  arenaAuth,
  social((req) => ArenaSocialService.report(req.arena, req.params.id, req.body))
);

// ─── Estatísticas (Módulo 08) — públicas e agregadas ────────────────────────
// Sem identidade em nenhuma resposta; cache curto na borda e no processo.
const stats = (fn) =>
  asyncHandler(async (req, res) => {
    const out = await fn(req.query);
    res.setHeader("Cache-Control", out.status === 200 ? "public, max-age=60" : "no-store");
    return send(res, out);
  });
router.get("/stats/meta", arenaRead, stats(() => ArenaStatsService.meta()));
router.get("/stats/series", arenaRead, stats((q) => ArenaStatsService.series(q)));
router.get("/stats/ranking", arenaRead, stats((q) => ArenaStatsService.ranking(q)));
router.get("/stats/environments", arenaRead, stats((q) => ArenaStatsService.environments(q)));
router.get("/stats/heatmap", arenaRead, stats((q) => ArenaStatsService.heatmap(q)));
router.get("/stats/preferences", arenaRead, stats((q) => ArenaStatsService.preferences(q)));

// ─── Canal interno (servidor de jogo) ────────────────────────────────────────
// Ordem: limite do serviço → assinatura do serviço → corpo pequeno → guard do
// usuário (identidade e elegibilidade ATUAIS do titular).

router.post(
  "/internal/session",
  arenaInternal,
  arenaService,
  arenaAuth,
  asyncHandler(async (req, res) => send(res, await ArenaService.startSession(req.arena)))
);

router.post(
  "/internal/checkpoints",
  arenaInternal,
  arenaService,
  smallBody,
  arenaAuth,
  asyncHandler(async (req, res) => send(res, await ArenaTerritoryService.checkpoint(req.arena, req.body)))
);

// Presença (M08): o servidor de jogo manda, fora do tick, uma batida por minuto.
// Corpo maior que o resto do canal (até 10 mil jogadores), ainda limitado.
const MAX_PRESENCE_BODY = 1024 * 1024;
router.post(
  "/internal/presence",
  arenaInternal,
  (req, res, next) => {
    const len = Number(req.headers["content-length"] || 0);
    if (len > MAX_PRESENCE_BODY) return res.status(413).json({ error: "Corpo grande demais", code: "payload_too_large" });
    return next();
  },
  arenaService,
  asyncHandler(async (req, res) => send(res, await ArenaPresenceService.ingest(req.body)))
);

router.get(
  "/internal/territory",
  arenaInternal,
  arenaService,
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return send(res, await ArenaTerritoryService.feed(req.query));
  })
);

module.exports = router;
