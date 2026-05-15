const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const resolveUserAccountProfile = require("../middlewares/resolveUserAccountProfile");
const PortfolioService = require("../services/PortfolioService");
const UploadPortfolioMediaService = require("../services/portfolio/UploadPortfolioMediaService");
const pool = require("../databases");
const uploadPortfolioMedia = require("../middlewares/uploadPortfolioMedia");
const asyncHandler = require("../utils/asyncHandler");
const { sendServiceResult } = require("../utils/sendServiceResult");

/**
 * Rotas de portfólio do USER ACCOUNT (perfil-fantasma is_user_account=TRUE).
 * Reaproveita PortfolioService inteiro mas passa o id_profile vindo do
 * middleware (req.userAccountProfileId) — assim não dependemos de mutar
 * req.params, que tem comportamento sutil em Express 5.
 */
const router = Router();

router.use(authMiddleware);
router.use(resolveUserAccountProfile);

// LIST
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const id_profile = req.userAccountProfileId;
    const rawKind =
      typeof req.query?.kind === "string" ? req.query.kind.toLowerCase() : null;
    const feed_kind = rawKind === "bees" || rawKind === "feed" ? rawKind : null;
    const result = await PortfolioService.listPublic({
      id_profile,
      id_user_viewer: req.user?.id_user ?? null,
      feed_kind,
    });
    return sendServiceResult(res, result);
  })
);

// CREATE
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const id_profile = req.userAccountProfileId;
    const result = await PortfolioService.createItem(
      req.user,
      { id_profile },
      req.body
    );
    return sendServiceResult(res, result, 201);
  })
);

// UPDATE
router.patch(
  "/:id_portfolio_item",
  asyncHandler(async (req, res) => {
    const id_profile = req.userAccountProfileId;
    const result = await PortfolioService.updateItem(
      req.user,
      { id_profile, id_portfolio_item: req.params.id_portfolio_item },
      req.body
    );
    return sendServiceResult(res, result);
  })
);

// SOFT DELETE
router.delete(
  "/:id_portfolio_item",
  asyncHandler(async (req, res) => {
    const id_profile = req.userAccountProfileId;
    const result = await PortfolioService.disableItem(req.user, {
      id_profile,
      id_portfolio_item: req.params.id_portfolio_item,
    });
    return sendServiceResult(res, result);
  })
);

// ADD MEDIA
router.post(
  "/:id_portfolio_item/media",
  asyncHandler(async (req, res) => {
    const id_profile = req.userAccountProfileId;
    const result = await PortfolioService.addMedia(
      req.user,
      { id_profile, id_portfolio_item: req.params.id_portfolio_item },
      req.body
    );
    return sendServiceResult(res, result, 201);
  })
);

// DISABLE MEDIA
router.delete(
  "/:id_portfolio_item/media/:id_portfolio_media",
  asyncHandler(async (req, res) => {
    const id_profile = req.userAccountProfileId;
    const result = await PortfolioService.disableMedia(req.user, {
      id_profile,
      id_portfolio_item: req.params.id_portfolio_item,
      id_portfolio_media: req.params.id_portfolio_media,
    });
    return sendServiceResult(res, result);
  })
);

// UPLOAD MEDIA (multipart)
router.post(
  "/:id_portfolio_item/upload",
  uploadPortfolioMedia.single("file"),
  asyncHandler(async (req, res) => {
    const id_profile = req.userAccountProfileId;
    const { id_user } = req.user;
    const result = await UploadPortfolioMediaService.execute({
      db: pool,
      id_user,
      params: { id_profile, id_portfolio_item: req.params.id_portfolio_item },
      body: req.body,
      file: req.file,
    });
    return res.status(201).json(result);
  })
);

module.exports = router;
