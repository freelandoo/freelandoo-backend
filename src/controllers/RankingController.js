// src/controllers/RankingController.js
const pool = require("../databases");
const RankingStorage = require("../storages/RankingStorage");
const XpStorage = require("../storages/XpStorage");
const NotificationService = require("../services/NotificationService");

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

    if (result?.liked) {
      NotificationService.notifyLike({
        actor_user_id: req.user.id_user,
        id_portfolio_item,
        id_profile,
      }).catch(() => {});
    }

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

    const canRate = await RankingStorage.userHasPaidBookingForProfile(pool, {
      id_user: req.user.id_user,
      id_profile,
    });
    if (!canRate) return res.status(403).json({ error: "Apenas clientes com agendamento pago podem avaliar" });

    const result = await RankingStorage.upsertRating(pool, {
      id_profile,
      id_user: req.user.id_user,
      rating: parseInt(rating, 10),
      comment,
    });

    // XP por avaliação recebida — fonte única por par (perfil, avaliador)
    XpStorage.award(pool, {
      id_profile,
      event_type: "review_received",
      source_type: "profile_rating",
      source_id: `${id_profile}_${req.user.id_user}`,
    }).catch(() => {});

    return res.json(result);
  },

  // GET /ranking/can-rate/:id_profile (autenticado)
  async canRate(req, res) {
    const { id_profile } = req.params;
    const allowed = await RankingStorage.userHasPaidBookingForProfile(pool, {
      id_user: req.user.id_user,
      id_profile,
    });
    return res.json({ can_rate: allowed });
  },

  // GET /ranking/ratings/:id_profile  (público)
  // Para clans, agrega ratings do clan + cada membro.
  async getRatings(req, res) {
    const { id_profile } = req.params;
    const profCheck = await pool.query(
      `SELECT is_clan FROM tb_profile WHERE id_profile = $1 AND deleted_at IS NULL`,
      [id_profile]
    );
    let profile_ids;
    if (profCheck.rows[0]?.is_clan) {
      const memberRows = await pool.query(
        `SELECT id_member_profile FROM tb_clan_member WHERE id_clan_profile = $1`,
        [id_profile]
      );
      profile_ids = [id_profile, ...memberRows.rows.map((r) => r.id_member_profile)];
    }
    const ratings = await RankingStorage.getRatings(pool, { id_profile, profile_ids });
    return res.json(ratings);
  },

  // POST /ranking/heartbeat  (requer auth)
  // Body: { minutes } — minutos decorridos desde o último heartbeat.
  async heartbeat(req, res) {
    // Teto de tempo online vive em xp_settings (página única de pesos).
    const xpSettings = await XpStorage.getSettings(pool);
    const maxOnline = Number(xpSettings?.max_online_minutes ?? 120);

    const { minutes_online, applied } = await RankingStorage.heartbeat(pool, {
      id_user: req.user.id_user,
      max_online_minutes: maxOnline,
      minutes: req.body?.minutes,
    });

    // XP por tempo online — concede unit_count = minutos efetivamente somados
    // (respeita o teto diário). source_id único por chamada evita duplicar.
    // Award para todos os subperfis ativos do usuário.
    if (applied > 0) {
      const today = new Date().toISOString().slice(0, 10);
      XpStorage.getUserActiveProfileIds(pool, req.user.id_user).then((profileIds) => {
        for (const id_profile of profileIds) {
          XpStorage.award(pool, {
            id_profile,
            event_type: "online_time",
            source_type: "heartbeat",
            source_id: `${req.user.id_user}_${today}_${minutes_online}`,
            unit_count: applied,
          }).catch(() => {});
        }
      }).catch(() => {});
    }

    return res.json({ minutes_online_today: minutes_online });
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

    // getEngagement já retorna defaults zerados quando o perfil ainda não
    // foi ranqueado, e sempre inclui temporada + pesos do tempo online.
    const engagement = await RankingStorage.getEngagement(pool, { id_profile });
    return res.json(engagement);
  },

  // GET /ranking/public/profile/:id_profile (público — pra botão Ranking no card)
  async getPublicProfilePosition(req, res) {
    const { id_profile } = req.params;
    const data = await RankingStorage.getPublicProfilePosition(pool, { id_profile });
    if (!data) return res.status(404).json({ error: "Perfil não encontrado" });
    return res.json(data);
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

  // GET /ranking/public/city?municipio=...&estado=...  (público)
  async getTopByCity(req, res) {
    const municipio = String(req.query.municipio || "").trim();
    const estado = String(req.query.estado || "").trim();
    const limit = Math.min(parseInt(req.query.limit ?? "10", 10), 20);
    if (!municipio || !estado) {
      return res.status(400).json({ error: "municipio e estado obrigatórios" });
    }
    const rows = await RankingStorage.getTopByCity(pool, { municipio, estado, limit });
    return res.json(rows);
  },

  // GET /ranking/public/region?id_region=...  (público)
  async getTopByRegion(req, res) {
    const id_region = parseInt(req.query.id_region ?? "", 10);
    const limit = Math.min(parseInt(req.query.limit ?? "10", 10), 20);
    if (!Number.isFinite(id_region)) {
      return res.status(400).json({ error: "id_region obrigatório" });
    }
    const rows = await RankingStorage.getTopByRegion(pool, { id_region, limit });
    return res.json(rows);
  },

  // GET /ranking/public/profession/:profession_slug  (público)
  async getTopByProfession(req, res) {
    const { profession_slug } = req.params;
    const limit = Math.min(parseInt(req.query.limit ?? "10", 10), 20);
    if (!profession_slug) {
      return res.status(400).json({ error: "profession_slug obrigatório" });
    }
    const rows = await RankingStorage.getTopByProfession(pool, { profession_slug, limit });
    return res.json(rows);
  },

  // GET /ranking/public/clans/general (público — top clans)
  async getTopClansGeneral(req, res) {
    const limit = Math.min(parseInt(req.query.limit ?? "20", 10), 50);
    const rows = await RankingStorage.getTopClansGeneral(pool, {
      limit,
      municipio: req.query.municipio || null,
    });
    return res.json(rows);
  },

  // GET /ranking/public/clans/machine/:id_machine
  async getTopClansByMachine(req, res) {
    const { id_machine } = req.params;
    const limit = Math.min(parseInt(req.query.limit ?? "10", 10), 50);
    const isNumeric = /^\d+$/.test(id_machine);
    const rows = await RankingStorage.getTopClansByMachine(pool, {
      id_machine: isNumeric ? parseInt(id_machine, 10) : null,
      machine_slug: isNumeric ? null : id_machine,
      limit,
    });
    return res.json(rows);
  },

  // GET /ranking/public/seasons  (público — Hall da Fama: temporadas encerradas)
  async getSeasons(req, res) {
    const seasons = await RankingStorage.listSeasons(pool);
    return res.json({ seasons });
  },

  // GET /ranking/public/seasons/:season_number  (público — campeões da temporada)
  async getSeasonChampions(req, res) {
    const seasonNumber = parseInt(req.params.season_number, 10);
    if (!Number.isInteger(seasonNumber) || seasonNumber < 1) {
      return res.status(400).json({ error: "season_number inválido" });
    }
    const limit = Math.min(parseInt(req.query.limit ?? "100", 10), 200);
    const champions = await RankingStorage.getSeasonArchive(pool, {
      season_number: seasonNumber,
      limit,
    });
    return res.json({ season_number: seasonNumber, champions });
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
  // ranking_config guarda só temporada + agendamento; pesos ficam em xp-settings.
  async adminUpdateConfig(req, res) {
    const { is_enabled, period_days } = req.body;
    await RankingStorage.updateConfig(pool, { is_enabled, period_days });
    const cfg = await RankingStorage.getConfig(pool);
    return res.json(cfg);
  },

  // POST /admin/ranking/recalculate
  async adminRecalculate(req, res) {
    const result = await RankingStorage.recalculate(pool);
    if (result?.reason === "already-running") {
      return res.status(409).json(result);
    }
    return res.json(result);
  },
};
