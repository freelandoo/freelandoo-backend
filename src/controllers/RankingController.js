// src/controllers/RankingController.js
const pool = require("../databases");
const RankingStorage = require("../storages/RankingStorage");

module.exports = {
  // POST /ranking/visit  (público, sem auth obrigatória)
  async recordVisit(req, res) {
    const { id_profile } = req.body;
    if (!id_profile) return res.status(400).json({ error: "id_profile obrigatório" });

    const id_user = req.user?.id_user ?? null;
    const visitor_ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? null;

    await RankingStorage.recordVisit(pool, { id_profile, id_user, visitor_ip });
    return res.status(204).end();
  },

  // POST /ranking/like  (requer auth)
  async toggleLike(req, res) {
    const { id_portfolio_item, id_profile } = req.body;
    if (!id_portfolio_item || !id_profile) return res.status(400).json({ error: "id_portfolio_item e id_profile obrigatórios" });

    const result = await RankingStorage.toggleLike(pool, {
      id_portfolio_item,
      id_profile,
      id_user: req.user.id_user,
    });
    return res.json(result);
  },

  // GET /ranking/likes/:id_profile  (requer auth)
  async getLikedItems(req, res) {
    const { id_profile } = req.params;
    const liked = await RankingStorage.getLikedItems(pool, { id_profile, id_user: req.user.id_user });
    return res.json({ liked });
  },

  // POST /ranking/rating  (requer auth + assinatura ativa)
  async upsertRating(req, res) {
    const { id_profile, rating, comment } = req.body;
    if (!id_profile || !rating) return res.status(400).json({ error: "id_profile e rating obrigatórios" });
    if (rating < 1 || rating > 5) return res.status(400).json({ error: "rating deve ser entre 1 e 5" });

    const canRate = await RankingStorage.userHasActiveSub(pool, { id_user: req.user.id_user });
    if (!canRate) return res.status(403).json({ error: "Apenas usuários com assinatura ativa podem avaliar" });

    const result = await RankingStorage.upsertRating(pool, {
      id_profile,
      id_user: req.user.id_user,
      rating: parseInt(rating, 10),
      comment,
    });
    return res.json(result);
  },

  // GET /ranking/ratings/:id_profile  (público)
  async getRatings(req, res) {
    const { id_profile } = req.params;
    const ratings = await RankingStorage.getRatings(pool, { id_profile });
    return res.json(ratings);
  },

  // POST /ranking/heartbeat  (requer auth)
  async heartbeat(req, res) {
    const cfg = await RankingStorage.getConfig(pool);
    const maxOnline = cfg?.max_online_minutes ?? 120;
    const minutes = await RankingStorage.heartbeat(pool, { id_user: req.user.id_user, max_online_minutes: maxOnline });
    return res.json({ minutes_online_today: minutes });
  },

  // GET /ranking/engagement/:id_profile  (requer auth + ser dono)
  async getEngagement(req, res) {
    const { id_profile } = req.params;

    // Verifica ownership: id_user dono do perfil
    const ownerCheck = await pool.query(
      `SELECT id_user FROM tb_profile WHERE id_profile = $1 AND deleted_at IS NULL`,
      [id_profile]
    );
    if (!ownerCheck.rows.length) return res.status(404).json({ error: "Perfil não encontrado" });
    if (ownerCheck.rows[0].id_user !== req.user.id_user) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    const engagement = await RankingStorage.getEngagement(pool, { id_profile });
    return res.json(engagement ?? {
      total_points: 0, visits_count: 0, likes_count: 0,
      ratings_count: 0, avg_rating: 0, online_minutes: 0,
      position_general: null, position_machine: null,
      position_city: null, position_profession: null,
    });
  },

  // GET /ranking/public/machine/:slug  (público — aceita slug ou id numérico)
  async getTopByMachine(req, res) {
    const { id_machine } = req.params;
    const limit = Math.min(parseInt(req.query.limit ?? "5", 10), 10);
    const isNumeric = /^\d+$/.test(id_machine);
    const rows = await RankingStorage.getTopByMachine(pool, {
      id_machine: isNumeric ? parseInt(id_machine, 10) : null,
      machine_slug: isNumeric ? null : id_machine,
      limit,
    });
    return res.json(rows);
  },

  // GET /ranking/public/general  (público)
  async getTopGeneral(req, res) {
    const limit = Math.min(parseInt(req.query.limit ?? "10", 10), 20);
    const rows = await RankingStorage.getTopGeneral(pool, { limit });
    return res.json(rows);
  },

  // ──────────────────────────────────── ADMIN ────────────────────────────────

  // GET /admin/rankings
  async adminGetRankings(req, res) {
    const { machine_slug, municipio, id_category, limit = 50, offset = 0 } = req.query;
    const rows = await RankingStorage.getAdminRankings(pool, {
      machine_slug, municipio, id_category,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
    return res.json(rows);
  },

  // GET /admin/ranking-config
  async adminGetConfig(req, res) {
    const cfg = await RankingStorage.getConfig(pool);
    return res.json(cfg);
  },

  // PUT /admin/ranking-config
  async adminUpdateConfig(req, res) {
    const { is_enabled, period_days, weight_visits, weight_likes, weight_ratings, weight_online, max_online_minutes } = req.body;
    const cfg = await RankingStorage.updateConfig(pool, {
      is_enabled, period_days, weight_visits, weight_likes, weight_ratings, weight_online, max_online_minutes,
    });
    return res.json(cfg);
  },

  // POST /admin/ranking/recalculate
  async adminRecalculate(req, res) {
    const result = await RankingStorage.recalculate(pool);
    return res.json(result);
  },
};
