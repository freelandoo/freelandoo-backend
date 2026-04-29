// src/storages/RankingStorage.js
module.exports = {
  // ──────────────────────────────────────────────────────────────────────────
  // CONFIG
  // ──────────────────────────────────────────────────────────────────────────
  async getConfig(db) {
    const r = await db.query("SELECT * FROM ranking_config WHERE id = 1");
    return r.rows[0] ?? null;
  },

  async updateConfig(db, { is_enabled, period_days, weight_visits, weight_likes, weight_ratings, weight_online, max_online_minutes }) {
    const r = await db.query(
      `UPDATE ranking_config SET
        is_enabled         = COALESCE($1, is_enabled),
        period_days        = COALESCE($2, period_days),
        weight_visits      = COALESCE($3, weight_visits),
        weight_likes       = COALESCE($4, weight_likes),
        weight_ratings     = COALESCE($5, weight_ratings),
        weight_online      = COALESCE($6, weight_online),
        max_online_minutes = COALESCE($7, max_online_minutes),
        updated_at         = NOW()
       WHERE id = 1
       RETURNING *`,
      [is_enabled, period_days, weight_visits, weight_likes, weight_ratings, weight_online, max_online_minutes]
    );
    return r.rows[0];
  },

  // ──────────────────────────────────────────────────────────────────────────
  // VISITAS
  // ──────────────────────────────────────────────────────────────────────────
  async recordVisit(db, { id_profile, id_user, visitor_ip }) {
    if (id_user) {
      // Deduplicação diária: verifica se já registrou visita hoje
      const exists = await db.query(
        `SELECT 1 FROM profile_visits
          WHERE id_profile = $1 AND id_user = $2
            AND visited_at >= CURRENT_DATE AND visited_at < CURRENT_DATE + INTERVAL '1 day'
          LIMIT 1`,
        [id_profile, id_user]
      );
      if (exists.rows.length > 0) return;
      await db.query(
        `INSERT INTO profile_visits (id_profile, id_user, visitor_ip) VALUES ($1, $2, $3)`,
        [id_profile, id_user, visitor_ip]
      );
    } else {
      await db.query(
        `INSERT INTO profile_visits (id_profile, visitor_ip) VALUES ($1, $2)`,
        [id_profile, visitor_ip]
      );
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // LIKES
  // ──────────────────────────────────────────────────────────────────────────
  async toggleLike(db, { id_portfolio_item, id_profile, id_user }) {
    const existing = await db.query(
      `SELECT id FROM portfolio_likes WHERE id_portfolio_item = $1 AND id_user = $2`,
      [id_portfolio_item, id_user]
    );
    if (existing.rows.length > 0) {
      await db.query(
        `DELETE FROM portfolio_likes WHERE id_portfolio_item = $1 AND id_user = $2`,
        [id_portfolio_item, id_user]
      );
      return { liked: false };
    }
    await db.query(
      `INSERT INTO portfolio_likes (id_portfolio_item, id_profile, id_user) VALUES ($1, $2, $3)`,
      [id_portfolio_item, id_profile, id_user]
    );
    return { liked: true };
  },

  async getLikedItems(db, { id_profile, id_user }) {
    const r = await db.query(
      `SELECT id_portfolio_item FROM portfolio_likes WHERE id_profile = $1 AND id_user = $2`,
      [id_profile, id_user]
    );
    return r.rows.map((row) => row.id_portfolio_item);
  },

  // ──────────────────────────────────────────────────────────────────────────
  // AVALIAÇÕES
  // ──────────────────────────────────────────────────────────────────────────
  async upsertRating(db, { id_profile, id_user, rating, comment }) {
    const r = await db.query(
      `INSERT INTO profile_ratings (id_profile, id_user, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id_profile, id_user) DO UPDATE
         SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, rated_at = NOW()
       RETURNING *`,
      [id_profile, id_user, rating, comment ?? null]
    );
    return r.rows[0];
  },

  async getRatings(db, { id_profile }) {
    const r = await db.query(
      `SELECT pr.id, pr.rating, pr.comment, pr.rated_at,
              tu.nome AS user_nome, tu.avatar AS user_avatar
         FROM profile_ratings pr
         JOIN tb_user tu ON tu.id_user = pr.id_user
        WHERE pr.id_profile = $1
        ORDER BY pr.rated_at DESC`,
      [id_profile]
    );
    return r.rows;
  },

  // Permite avaliação apenas se o usuário tem booking PAGO com este perfil.
  // Correlação por email — booking não armazena id_user do cliente.
  async userHasPaidBookingForProfile(db, { id_user, id_profile }) {
    const r = await db.query(
      `SELECT 1
         FROM tb_profile_bookings b
         JOIN tb_user u ON LOWER(u.email) = LOWER(b.client_email)
        WHERE b.id_profile = $1
          AND u.id_user = $2
          AND b.payment_status = 'paid'
        LIMIT 1`,
      [id_profile, id_user]
    );
    return r.rows.length > 0;
  },

  // ──────────────────────────────────────────────────────────────────────────
  // TEMPO ONLINE (heartbeat — incrementa 1 min por chamada, máx configurável)
  // ──────────────────────────────────────────────────────────────────────────
  async heartbeat(db, { id_user, max_online_minutes }) {
    const max = max_online_minutes ?? 120;
    const r = await db.query(
      `INSERT INTO user_online_time (id_user, date, minutes_online)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (id_user, date) DO UPDATE
         SET minutes_online = LEAST(user_online_time.minutes_online + 1, $2)
       RETURNING minutes_online`,
      [id_user, max]
    );
    return r.rows[0]?.minutes_online ?? 0;
  },

  // ──────────────────────────────────────────────────────────────────────────
  // RECALCULA RANKING
  // ──────────────────────────────────────────────────────────────────────────
  async recalculate(db) {
    const cfg = await this.getConfig(db);
    if (!cfg || !cfg.is_enabled) return { updated: 0 };

    const periodDays = cfg.period_days ?? 30;
    const wv = cfg.weight_visits ?? 1;
    const wl = cfg.weight_likes ?? 2;
    const wr = cfg.weight_ratings ?? 5;
    const wo = cfg.weight_online ?? 0.5;
    const maxOnline = cfg.max_online_minutes ?? 120;

    // Upsert pontuação bruta para cada perfil publicado
    await db.query(
      `INSERT INTO profile_ranking
         (id_profile, total_points, visits_count, likes_count, ratings_count, avg_rating, online_minutes, updated_at)
       SELECT
         pro.id_profile,
         -- fórmula
         COALESCE(v.cnt, 0) * $1
           + COALESCE(l.cnt, 0) * $2
           + COALESCE(rat.avg_r, 0) * COALESCE(rat.cnt, 0) * $3
           + LEAST(COALESCE(o.mins, 0), $5) * $4    AS total_points,
         COALESCE(v.cnt,   0) AS visits_count,
         COALESCE(l.cnt,   0) AS likes_count,
         COALESCE(rat.cnt, 0) AS ratings_count,
         COALESCE(rat.avg_r, 0) AS avg_rating,
         LEAST(COALESCE(o.mins, 0), $5) AS online_minutes,
         NOW()
       FROM tb_profile pro
       JOIN tb_profile_subscription psub ON psub.id_profile = pro.id_profile AND psub.status = 'active'
       JOIN tb_user tu ON tu.id_user = pro.id_user

       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS cnt
           FROM profile_visits pv
          WHERE pv.id_profile = pro.id_profile
            AND pv.visited_at >= NOW() - ($6 || ' days')::interval
       ) v ON TRUE

       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS cnt
           FROM portfolio_likes pl
          WHERE pl.id_profile = pro.id_profile
            AND pl.liked_at >= NOW() - ($6 || ' days')::interval
       ) l ON TRUE

       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS cnt, COALESCE(AVG(rating), 0)::numeric(4,2) AS avg_r
           FROM profile_ratings pr
          WHERE pr.id_profile = pro.id_profile
            AND pr.rated_at >= NOW() - ($6 || ' days')::interval
       ) rat ON TRUE

       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(uot.minutes_online), 0)::int AS mins
           FROM user_online_time uot
          WHERE uot.id_user = pro.id_user
            AND uot.date >= CURRENT_DATE - $6::int
       ) o ON TRUE

       WHERE pro.is_visible = TRUE AND pro.deleted_at IS NULL AND tu.ativo = TRUE
         AND pro.is_clan = FALSE

       ON CONFLICT (id_profile) DO UPDATE SET
         total_points    = EXCLUDED.total_points,
         visits_count    = EXCLUDED.visits_count,
         likes_count     = EXCLUDED.likes_count,
         ratings_count   = EXCLUDED.ratings_count,
         avg_rating      = EXCLUDED.avg_rating,
         online_minutes  = EXCLUDED.online_minutes,
         updated_at      = NOW()`,
      [wv, wl, wr, wo, maxOnline, periodDays]
    );

    // Pass 2 — ranking de clans = soma agregada das métricas de seus membros
    await db.query(
      `INSERT INTO profile_ranking
         (id_profile, total_points, visits_count, likes_count, ratings_count, avg_rating, online_minutes, updated_at)
       SELECT
         clan.id_profile,
         COALESCE(SUM(mr.visits_count), 0)  * $1
           + COALESCE(SUM(mr.likes_count), 0) * $2
           + COALESCE(SUM(mr.avg_rating * mr.ratings_count), 0) * $3
           + COALESCE(SUM(mr.online_minutes), 0) * $4 AS total_points,
         COALESCE(SUM(mr.visits_count), 0)::int   AS visits_count,
         COALESCE(SUM(mr.likes_count), 0)::int    AS likes_count,
         COALESCE(SUM(mr.ratings_count), 0)::int  AS ratings_count,
         CASE
           WHEN COALESCE(SUM(mr.ratings_count), 0) > 0
             THEN (SUM(mr.avg_rating * mr.ratings_count)::numeric / SUM(mr.ratings_count))::numeric(4,2)
           ELSE 0
         END AS avg_rating,
         COALESCE(SUM(mr.online_minutes), 0)::int AS online_minutes,
         NOW()
       FROM tb_profile clan
       LEFT JOIN tb_clan_member cm ON cm.id_clan_profile = clan.id_profile
       LEFT JOIN profile_ranking mr ON mr.id_profile = cm.id_member_profile
       WHERE clan.is_clan = TRUE
         AND clan.deleted_at IS NULL
         AND clan.is_visible = TRUE
       GROUP BY clan.id_profile
       ON CONFLICT (id_profile) DO UPDATE SET
         total_points    = EXCLUDED.total_points,
         visits_count    = EXCLUDED.visits_count,
         likes_count     = EXCLUDED.likes_count,
         ratings_count   = EXCLUDED.ratings_count,
         avg_rating      = EXCLUDED.avg_rating,
         online_minutes  = EXCLUDED.online_minutes,
         updated_at      = NOW()`,
      [wv, wl, wr, wo]
    );

    // Ranking geral
    await db.query(`
      UPDATE profile_ranking pr
         SET position_general = sub.pos
        FROM (
          SELECT id_profile, ROW_NUMBER() OVER (ORDER BY total_points DESC) AS pos
            FROM profile_ranking
        ) sub
       WHERE pr.id_profile = sub.id_profile
    `);

    // Ranking por máquina (clans têm id_machine direto; perfis comuns via category)
    await db.query(`
      UPDATE profile_ranking pr
         SET position_machine = sub.pos
        FROM (
          SELECT pro.id_profile,
                 ROW_NUMBER() OVER (
                   PARTITION BY COALESCE(ca.id_machine, pro.id_machine)
                   ORDER BY pr2.total_points DESC
                 ) AS pos
            FROM profile_ranking pr2
            JOIN tb_profile pro ON pro.id_profile = pr2.id_profile
            LEFT JOIN tb_category ca ON ca.id_category = pro.id_category
        ) sub
       WHERE pr.id_profile = sub.id_profile
    `);

    // Ranking por cidade
    await db.query(`
      UPDATE profile_ranking pr
         SET position_city = sub.pos
        FROM (
          SELECT pro.id_profile,
                 ROW_NUMBER() OVER (PARTITION BY pro.municipio ORDER BY pr2.total_points DESC) AS pos
            FROM profile_ranking pr2
            JOIN tb_profile pro ON pro.id_profile = pr2.id_profile
        ) sub
       WHERE pr.id_profile = sub.id_profile
    `);

    // Ranking por profissão (categoria)
    await db.query(`
      UPDATE profile_ranking pr
         SET position_profession = sub.pos
        FROM (
          SELECT pro.id_profile,
                 ROW_NUMBER() OVER (PARTITION BY pro.id_category ORDER BY pr2.total_points DESC) AS pos
            FROM profile_ranking pr2
            JOIN tb_profile pro ON pro.id_profile = pr2.id_profile
        ) sub
       WHERE pr.id_profile = sub.id_profile
    `);

    await db.query(`UPDATE ranking_config SET last_recalculated_at = NOW() WHERE id = 1`);

    const count = await db.query(`SELECT COUNT(*) FROM profile_ranking`);
    return { updated: parseInt(count.rows[0].count, 10) };
  },

  // Recálculo automático: roda só se passou period_days desde o último
  async runScheduledRecalculate(db) {
    const cfg = await this.getConfig(db);
    if (!cfg || !cfg.is_enabled) return { skipped: true, reason: "disabled" };

    const periodDays = cfg.period_days ?? 30;
    if (cfg.last_recalculated_at) {
      const r = await db.query(
        `SELECT (NOW() - $1::timestamptz) >= ($2 || ' days')::interval AS due`,
        [cfg.last_recalculated_at, periodDays]
      );
      if (!r.rows[0]?.due) return { skipped: true, reason: "not-due" };
    }

    return await this.recalculate(db);
  },

  // ──────────────────────────────────────────────────────────────────────────
  // ENGAJAMENTO DO PERFIL (para o dono)
  // ──────────────────────────────────────────────────────────────────────────
  async getEngagement(db, { id_profile }) {
    const r = await db.query(
      `SELECT
         pr.total_points,
         pr.visits_count,
         pr.likes_count,
         pr.ratings_count,
         pr.avg_rating,
         pr.online_minutes,
         pr.position_general,
         pr.position_machine,
         pr.position_city,
         pr.position_profession,
         pr.updated_at
       FROM profile_ranking pr
       WHERE pr.id_profile = $1`,
      [id_profile]
    );
    return r.rows[0] ?? null;
  },

  // ──────────────────────────────────────────────────────────────────────────
  // RANKINGS PÚBLICOS (home e admin)
  // ──────────────────────────────────────────────────────────────────────────
  // Posição pública de um perfil (pra botão "Ranking" no card)
  async getPublicProfilePosition(db, { id_profile }) {
    const r = await db.query(
      `SELECT
         pr.position_general,
         pr.position_machine,
         pr.position_city,
         pr.position_profession,
         pr.total_points,
         pr.avg_rating,
         pr.ratings_count,
         pr.visits_count,
         pr.likes_count,
         pro.municipio,
         pro.estado,
         m.name AS machine_name,
         m.slug AS machine_slug,
         ca.desc_category AS specialty
       FROM tb_profile pro
       LEFT JOIN profile_ranking pr ON pr.id_profile = pro.id_profile
       LEFT JOIN tb_category ca ON ca.id_category = pro.id_category
       LEFT JOIN tb_machine m ON m.id_machine = ca.id_machine
       WHERE pro.id_profile = $1 AND pro.deleted_at IS NULL`,
      [id_profile]
    );
    return r.rows[0] ?? null;
  },

  async getTopByMachine(db, { id_machine, machine_slug, limit = 5 }) {
    const r = await db.query(
      `SELECT
         pro.id_profile,
         pro.display_name,
         pro.avatar_url,
         pro.municipio,
         pro.estado,
         ca.desc_category AS specialty,
         pr.total_points,
         pr.avg_rating,
         pr.visits_count,
         pr.likes_count,
         pr.position_machine
       FROM profile_ranking pr
       JOIN tb_profile pro ON pro.id_profile = pr.id_profile
       JOIN tb_category ca ON ca.id_category = pro.id_category
       JOIN tb_machine m ON m.id_machine = ca.id_machine
       WHERE ($1::int IS NULL OR ca.id_machine = $1)
         AND ($3::text IS NULL OR m.slug = $3)
       ORDER BY pr.position_machine ASC NULLS LAST
       LIMIT $2`,
      [id_machine ? parseInt(id_machine, 10) : null, limit, machine_slug || null]
    );
    return r.rows;
  },

  async getTopGeneral(db, { limit = 10 }) {
    const r = await db.query(
      `SELECT
         pro.id_profile,
         pro.display_name,
         pro.avatar_url,
         pro.municipio,
         pro.estado,
         ca.desc_category AS specialty,
         m.name AS machine_name,
         m.slug AS machine_slug,
         pr.total_points,
         pr.avg_rating,
         pr.visits_count,
         pr.likes_count,
         pr.position_general
       FROM profile_ranking pr
       JOIN tb_profile pro ON pro.id_profile = pr.id_profile
       JOIN tb_category ca ON ca.id_category = pro.id_category
       LEFT JOIN tb_machine m ON m.id_machine = ca.id_machine
       ORDER BY pr.position_general ASC NULLS LAST
       LIMIT $1`,
      [limit]
    );
    return r.rows;
  },

  /**
   * Top clans (filtra is_clan = TRUE; usa pro.id_machine direto). Equivalente
   * ao getTopByMachine mas só clans.
   */
  async getTopClansByMachine(db, { id_machine, machine_slug, limit = 10 }) {
    const r = await db.query(
      `SELECT
         pro.id_profile,
         pro.display_name,
         pro.avatar_url,
         pro.municipio,
         pro.estado,
         m.name AS machine_name,
         m.slug AS machine_slug,
         pr.total_points,
         pr.avg_rating,
         pr.visits_count,
         pr.likes_count,
         pr.position_machine,
         (SELECT COUNT(*)::int FROM tb_clan_member cm WHERE cm.id_clan_profile = pro.id_profile) AS members_count
       FROM profile_ranking pr
       JOIN tb_profile pro ON pro.id_profile = pr.id_profile
       LEFT JOIN tb_machine m ON m.id_machine = pro.id_machine
       WHERE pro.is_clan = TRUE
         AND pro.deleted_at IS NULL
         AND pro.is_visible = TRUE
         AND ($1::int  IS NULL OR pro.id_machine = $1)
         AND ($3::text IS NULL OR m.slug = $3)
       ORDER BY pr.position_machine ASC NULLS LAST, pr.total_points DESC
       LIMIT $2`,
      [id_machine ? parseInt(id_machine, 10) : null, limit, machine_slug || null]
    );
    return r.rows;
  },

  async getTopClansGeneral(db, { limit = 20, municipio } = {}) {
    const r = await db.query(
      `SELECT
         pro.id_profile,
         pro.display_name,
         pro.avatar_url,
         pro.municipio,
         pro.estado,
         m.name AS machine_name,
         m.slug AS machine_slug,
         pr.total_points,
         pr.avg_rating,
         pr.visits_count,
         pr.likes_count,
         pr.position_general,
         (SELECT COUNT(*)::int FROM tb_clan_member cm WHERE cm.id_clan_profile = pro.id_profile) AS members_count
       FROM profile_ranking pr
       JOIN tb_profile pro ON pro.id_profile = pr.id_profile
       LEFT JOIN tb_machine m ON m.id_machine = pro.id_machine
       WHERE pro.is_clan = TRUE
         AND pro.deleted_at IS NULL
         AND pro.is_visible = TRUE
         AND ($2::text IS NULL OR pro.municipio ILIKE $2)
       ORDER BY pr.total_points DESC NULLS LAST
       LIMIT $1`,
      [limit, municipio ? `%${municipio}%` : null]
    );
    return r.rows;
  },

  async getAdminRankings(db, { machine_slug, municipio, id_category, limit = 50, offset = 0 }) {
    const r = await db.query(
      `SELECT
         pro.id_profile,
         pro.display_name,
         pro.avatar_url,
         pro.municipio,
         pro.estado,
         ca.desc_category AS specialty,
         m.name AS machine_name,
         m.slug AS machine_slug,
         pr.total_points,
         pr.visits_count,
         pr.likes_count,
         pr.ratings_count,
         pr.avg_rating,
         pr.online_minutes,
         pr.position_general,
         pr.position_machine,
         pr.position_city,
         pr.position_profession,
         pr.updated_at
       FROM profile_ranking pr
       JOIN tb_profile pro ON pro.id_profile = pr.id_profile
       JOIN tb_category ca ON ca.id_category = pro.id_category
       LEFT JOIN tb_machine m ON m.id_machine = ca.id_machine
       WHERE ($1::text IS NULL OR m.slug = $1)
         AND ($2::text IS NULL OR pro.municipio ILIKE $2)
         AND ($3::int  IS NULL OR ca.id_category = $3)
       ORDER BY pr.position_general ASC NULLS LAST
       LIMIT $4 OFFSET $5`,
      [machine_slug || null, municipio || null, id_category ? parseInt(id_category) : null, limit, offset]
    );
    return r.rows;
  },
};
