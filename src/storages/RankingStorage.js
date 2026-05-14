// src/storages/RankingStorage.js
const pool = require("../databases");
const XpStorage = require("./XpStorage");

const RANKING_RECALCULATE_LOCK_KEY = 57289154;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

module.exports = {
  // ──────────────────────────────────────────────────────────────────────────
  // CONFIG
  // ──────────────────────────────────────────────────────────────────────────
  async getConfig(db) {
    const r = await db.query("SELECT * FROM ranking_config WHERE id = 1");
    const cfg = r.rows[0] ?? null;
    if (!cfg) return null;
    return {
      ...cfg,
      recalculation_interval_hours: 2,
      next_recalculation_at: cfg.last_recalculated_at
        ? new Date(new Date(cfg.last_recalculated_at).getTime() + TWO_HOURS_MS).toISOString()
        : null,
    };
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
      // XP por visita ao perfil (autenticado, dedup diário via source_id)
      const today = new Date().toISOString().slice(0, 10);
      XpStorage.award(pool, {
        id_profile,
        event_type: "profile_visit",
        source_type: "user_visit",
        source_id: `${id_user}_${id_profile}_${today}`,
      }).catch(() => {});
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
  async toggleLike(pool, { id_portfolio_item, id_profile, id_user }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query(
        `SELECT id FROM portfolio_likes
          WHERE id_portfolio_item = $1 AND id_user = $2`,
        [id_portfolio_item, id_user]
      );

      let delta;
      let liked;
      if (existing.rows.length > 0) {
        await client.query(
          `DELETE FROM portfolio_likes
            WHERE id_portfolio_item = $1 AND id_user = $2`,
          [id_portfolio_item, id_user]
        );
        delta = -1;
        liked = false;
      } else {
        await client.query(
          `INSERT INTO portfolio_likes (id_portfolio_item, id_profile, id_user)
           VALUES ($1, $2, $3)`,
          [id_portfolio_item, id_profile, id_user]
        );
        delta = 1;
        liked = true;
      }

      // Mantém likes_count e engagement_score em sync com o feed (slice 2A).
      // GREATEST evita underflow se houver drift entre tb_profile_portfolio_item
      // e portfolio_likes.
      const upd = await client.query(
        `UPDATE tb_profile_portfolio_item
            SET likes_count = GREATEST(likes_count + $2, 0),
                engagement_score =
                    GREATEST(likes_count + $2, 0) * 1
                  + shares_count          * 3
                  + profile_clicks_count  * 4
                  + whatsapp_clicks_count * 6
                  + social_clicks_count   * 2
          WHERE id_portfolio_item = $1
          RETURNING likes_count`,
        [id_portfolio_item, delta]
      );

      await client.query("COMMIT");

      // XP por like recebido — fire-and-forget após commit
      // source_id garante: mesmo usuário só gera XP uma vez por post (sem limite diário)
      if (liked) {
        XpStorage.award(pool, {
          id_profile,
          event_type: "like_received",
          source_type: "portfolio_like",
          source_id: `${id_portfolio_item}_${id_user}`,
        }).catch(() => {});
      }

      return {
        liked,
        likes_count: upd.rows[0]?.likes_count ?? null,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
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

  async getRatings(db, { id_profile, profile_ids }) {
    const ids = profile_ids && profile_ids.length ? profile_ids : [id_profile];
    const r = await db.query(
      `SELECT pr.id, pr.id_profile, pr.rating, pr.comment, pr.rated_at,
              tu.nome AS user_nome, tu.avatar AS user_avatar,
              target.display_name AS target_display_name,
              target_user.username AS target_username
         FROM profile_ratings pr
         JOIN tb_user tu ON tu.id_user = pr.id_user
         JOIN tb_profile target ON target.id_profile = pr.id_profile
         JOIN tb_user target_user ON target_user.id_user = target.id_user
        WHERE pr.id_profile = ANY($1::uuid[])
        ORDER BY pr.rated_at DESC`,
      [ids]
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
    const client = await db.connect();
    let locked = false;
    try {
      const lock = await client.query(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [RANKING_RECALCULATE_LOCK_KEY]
      );
      locked = Boolean(lock.rows[0]?.locked);
      if (!locked) {
        return {
          success: false,
          skipped: true,
          reason: "already-running",
          message: "Ranking recalculation already running",
        };
      }
      return await this.recalculateUnlocked(client);
    } finally {
      if (locked) {
        await client.query("SELECT pg_advisory_unlock($1)", [RANKING_RECALCULATE_LOCK_KEY]).catch(() => {});
      }
      client.release();
    }
  },

  async recalculateUnlocked(db) {
    const cfg = await this.getConfig(db);
    if (!cfg || !cfg.is_enabled) {
      return { success: false, skipped: true, reason: "disabled", updated: 0 };
    }

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
         AND pro.is_user_account = FALSE
         AND pro.ranking_visible = TRUE

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

    // Pass 2 — pontuação do clan = média simples dos total_points dos membros
    // (SUM(member.total_points) / COUNT(membros do clan)). Métricas auxiliares
    // (visits/likes/ratings_count/online_minutes) seguem somadas como info; a
    // avg_rating é média ponderada pelo número de avaliações de cada membro.
    await db.query(
      `INSERT INTO profile_ranking
         (id_profile, total_points, visits_count, likes_count, ratings_count, avg_rating, online_minutes, updated_at)
       SELECT
         clan.id_profile,
         CASE
           WHEN COUNT(cm.id_member_profile) > 0
             THEN (COALESCE(SUM(mr.total_points), 0)::numeric / COUNT(cm.id_member_profile))
           ELSE 0
         END AS total_points,
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
         updated_at      = NOW()`
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
    const recalculatedAt = new Date().toISOString();
    return {
      success: true,
      updated: parseInt(count.rows[0].count, 10),
      entities_processed: parseInt(count.rows[0].count, 10),
      recalculated_at: recalculatedAt,
      next_recalculation: new Date(Date.now() + TWO_HOURS_MS).toISOString(),
    };
  },

  // Recálculo automático: roda a cada 2 horas, sem recalcular em page load.
  async runScheduledRecalculate(db) {
    const cfg = await this.getConfig(db);
    if (!cfg || !cfg.is_enabled) return { skipped: true, reason: "disabled" };

    if (cfg.last_recalculated_at) {
      const r = await db.query(
        `SELECT (NOW() - $1::timestamptz) >= INTERVAL '2 hours' AS due`,
        [cfg.last_recalculated_at]
      );
      if (!r.rows[0]?.due) return { skipped: true, reason: "not-due" };
    }

    return await this.recalculate(db);
  },

  async attachXpSummaries(db, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const summaries = await XpStorage.getXpSummaries(
      db,
      rows.map((row) => row.id_profile)
    );
    const updated = await db.query(
      `SELECT MAX(updated_at) AS last_recalculated_at
         FROM profile_ranking
        WHERE id_profile = ANY($1::uuid[])`,
      [rows.map((row) => row.id_profile).filter(Boolean)]
    );
    const lastRecalculatedAt = updated.rows[0]?.last_recalculated_at ?? null;
    return rows.map((row) => {
      const xp = summaries.get(String(row.id_profile)) || {
        xp_total: 0,
        xp_level: 0,
        level: 0,
        xp_current_level: 0,
        xp_next_level: 0,
        xp_missing: 0,
        xp_progress_percent: 0,
      };
      return {
        ...row,
        entity_type: row.is_clan ? "clan" : "profile",
        entity_id: row.id_profile,
        ranking_score: row.total_points,
        ranking_updated_at: row.updated_at ?? lastRecalculatedAt,
        last_recalculated_at: lastRecalculatedAt,
        rank_position:
          row.position_general ??
          row.position_machine ??
          row.position_city ??
          row.position_profession ??
          null,
        ...xp,
      };
    });
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
  // Posição pública de um perfil (pra botão "Ranking" no card).
  // Para clans, máquina vem direto de pro.id_machine, e profession/specialty
  // vêm da categoria do subperfil OWNER (clan não tem categoria própria, mas
  // o dono determina a "profissão de referência" pra navegação no modal).
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
         pro.is_clan,
         COALESCE(ca.id_machine, pro.id_machine) AS id_machine,
         COALESCE(mc.name, mp.name) AS machine_name,
         COALESCE(mc.slug, mp.slug) AS machine_slug,
         COALESCE(ca.id_category, oca.id_category) AS id_category,
         COALESCE(ca.profession_slug, oca.profession_slug) AS profession_slug,
         COALESCE(ca.desc_category, oca.desc_category) AS specialty
       FROM tb_profile pro
       LEFT JOIN profile_ranking pr ON pr.id_profile = pro.id_profile
       LEFT JOIN tb_category ca ON ca.id_category = pro.id_category
       LEFT JOIN tb_machine mc ON mc.id_machine = ca.id_machine
       LEFT JOIN tb_machine mp ON mp.id_machine = pro.id_machine
       -- Owner do clan (se for clan): pega categoria/profissão do subperfil dono.
       LEFT JOIN tb_clan_member ocm
         ON pro.is_clan = TRUE AND ocm.id_clan_profile = pro.id_profile AND ocm.role = 'owner'
       LEFT JOIN tb_profile op ON op.id_profile = ocm.id_member_profile
       LEFT JOIN tb_category oca ON oca.id_category = op.id_category
       WHERE pro.id_profile = $1 AND pro.deleted_at IS NULL`,
      [id_profile]
    );
    return r.rows[0] ?? null;
  },

  /**
   * Top N por (municipio, estado). Considera só perfis vivos com ranking calc.
   */
  async getTopByCity(db, { municipio, estado, limit = 10 }) {
    // Inclui perfis cuja municipio/estado bate, e clans cujo qualquer membro
    // tem essa cidade. Position é computada on-the-fly (ranking por cidade
    // não pode ser pré-calculado para clans, que aparecem em N cidades).
    const r = await db.query(
      `WITH base AS (
         SELECT
           pro.id_profile,
           pro.display_name,
           pro.avatar_url,
           pro.municipio,
           pro.estado,
           u.username,
           pro.sub_profile_slug,
           ca.desc_category AS specialty,
           ca.profession_slug,
           m.slug AS machine_slug,
           m.name AS machine_name,
           pr.total_points,
           pr.avg_rating,
           pr.ratings_count,
           pr.visits_count,
           pr.likes_count,
           FALSE AS is_clan,
           NULL::int AS members_count
         FROM profile_ranking pr
         JOIN tb_profile pro ON pro.id_profile = pr.id_profile
         JOIN tb_user u ON u.id_user = pro.id_user
         JOIN tb_category ca ON ca.id_category = pro.id_category
         LEFT JOIN tb_machine m ON m.id_machine = ca.id_machine
         WHERE pro.deleted_at IS NULL
           AND pro.is_clan = FALSE
           AND pro.is_user_account = FALSE
           AND pro.ranking_visible = TRUE
           AND lower(pro.municipio) = lower($1)
           AND lower(pro.estado) = lower($2)
         UNION ALL
         SELECT
           clan.id_profile,
           clan.display_name,
           clan.avatar_url,
           clan.municipio,
           clan.estado,
           ou.username,
           NULL AS sub_profile_slug,
           NULL AS specialty,
           NULL AS profession_slug,
           mc.slug AS machine_slug,
           mc.name AS machine_name,
           pr.total_points,
           pr.avg_rating,
           pr.ratings_count,
           pr.visits_count,
           pr.likes_count,
           TRUE AS is_clan,
           (SELECT COUNT(*)::int FROM tb_clan_member cm2 WHERE cm2.id_clan_profile = clan.id_profile) AS members_count
         FROM profile_ranking pr
         JOIN tb_profile clan ON clan.id_profile = pr.id_profile
         LEFT JOIN tb_machine mc ON mc.id_machine = clan.id_machine
         JOIN tb_clan_member ocm
           ON ocm.id_clan_profile = clan.id_profile AND ocm.role = 'owner'
         JOIN tb_profile op ON op.id_profile = ocm.id_member_profile
         JOIN tb_user ou ON ou.id_user = op.id_user
         WHERE clan.is_clan = TRUE
           AND clan.deleted_at IS NULL
           AND clan.is_visible = TRUE
           AND (
             (lower(clan.municipio) = lower($1) AND lower(clan.estado) = lower($2))
             OR EXISTS (
               SELECT 1 FROM tb_clan_member cmf
               JOIN tb_profile mpf ON mpf.id_profile = cmf.id_member_profile
               WHERE cmf.id_clan_profile = clan.id_profile
                 AND lower(mpf.municipio) = lower($1)
                 AND lower(mpf.estado)    = lower($2)
             )
           )
       )
       SELECT *,
              ROW_NUMBER() OVER (ORDER BY total_points DESC NULLS LAST, display_name) AS position_city
         FROM base
        ORDER BY position_city
        LIMIT $3`,
      [municipio, estado, limit]
    );
    return this.attachXpSummaries(db, r.rows);
  },

  /**
   * Top N por profession_slug (categoria/profissão).
   */
  async getTopByProfession(db, { profession_slug, limit = 10 }) {
    const r = await db.query(
      `WITH base AS (
         SELECT
           pro.id_profile,
           pro.display_name,
           pro.avatar_url,
           pro.municipio,
           pro.estado,
           u.username,
           pro.sub_profile_slug,
           ca.desc_category AS specialty,
           ca.profession_slug,
           m.slug AS machine_slug,
           m.name AS machine_name,
           pr.total_points,
           pr.avg_rating,
           pr.ratings_count,
           pr.visits_count,
           pr.likes_count,
           FALSE AS is_clan,
           NULL::int AS members_count
         FROM profile_ranking pr
         JOIN tb_profile pro ON pro.id_profile = pr.id_profile
         JOIN tb_user u ON u.id_user = pro.id_user
         JOIN tb_category ca ON ca.id_category = pro.id_category
         LEFT JOIN tb_machine m ON m.id_machine = ca.id_machine
         WHERE pro.deleted_at IS NULL
           AND pro.is_clan = FALSE
           AND pro.is_user_account = FALSE
           AND pro.ranking_visible = TRUE
           AND lower(ca.profession_slug) = lower($1)
         UNION ALL
         SELECT
           clan.id_profile,
           clan.display_name,
           clan.avatar_url,
           clan.municipio,
           clan.estado,
           ou.username,
           NULL AS sub_profile_slug,
           NULL AS specialty,
           $1::text AS profession_slug,
           mc.slug AS machine_slug,
           mc.name AS machine_name,
           pr.total_points,
           pr.avg_rating,
           pr.ratings_count,
           pr.visits_count,
           pr.likes_count,
           TRUE AS is_clan,
           (SELECT COUNT(*)::int FROM tb_clan_member cm2 WHERE cm2.id_clan_profile = clan.id_profile) AS members_count
         FROM profile_ranking pr
         JOIN tb_profile clan ON clan.id_profile = pr.id_profile
         LEFT JOIN tb_machine mc ON mc.id_machine = clan.id_machine
         JOIN tb_clan_member ocm
           ON ocm.id_clan_profile = clan.id_profile AND ocm.role = 'owner'
         JOIN tb_profile op ON op.id_profile = ocm.id_member_profile
         JOIN tb_user ou ON ou.id_user = op.id_user
         WHERE clan.is_clan = TRUE
           AND clan.deleted_at IS NULL
           AND clan.is_visible = TRUE
           AND EXISTS (
             SELECT 1 FROM tb_clan_member cmf
             JOIN tb_profile mpf ON mpf.id_profile = cmf.id_member_profile
             JOIN tb_category caf ON caf.id_category = mpf.id_category
             WHERE cmf.id_clan_profile = clan.id_profile
               AND lower(caf.profession_slug) = lower($1)
           )
           -- (Clan não tem profession própria — só via membros.)
       )
       SELECT *,
              ROW_NUMBER() OVER (ORDER BY total_points DESC NULLS LAST, display_name) AS position_profession
         FROM base
        ORDER BY position_profession
        LIMIT $2`,
      [profession_slug, limit]
    );
    return this.attachXpSummaries(db, r.rows);
  },

  async getTopByMachine(db, { id_machine, machine_slug, limit = 5 }) {
    const r = await db.query(
      `WITH base AS (
         SELECT
           pro.id_profile,
           pro.display_name,
           pro.avatar_url,
           pro.municipio,
           pro.estado,
           u.username,
           pro.sub_profile_slug,
           ca.desc_category AS specialty,
           ca.profession_slug,
           m.slug AS machine_slug,
           m.name AS machine_name,
           pr.total_points,
           pr.avg_rating,
           pr.ratings_count,
           pr.visits_count,
           pr.likes_count,
           FALSE AS is_clan,
           NULL::int AS members_count
         FROM profile_ranking pr
         JOIN tb_profile pro ON pro.id_profile = pr.id_profile
         JOIN tb_user u ON u.id_user = pro.id_user
         JOIN tb_category ca ON ca.id_category = pro.id_category
         JOIN tb_machine m ON m.id_machine = ca.id_machine
         WHERE pro.deleted_at IS NULL
           AND pro.is_clan = FALSE
           AND pro.is_user_account = FALSE
           AND pro.ranking_visible = TRUE
           AND ($1::int IS NULL OR ca.id_machine = $1)
           AND ($3::text IS NULL OR m.slug = $3)
         UNION ALL
         SELECT
           clan.id_profile,
           clan.display_name,
           clan.avatar_url,
           clan.municipio,
           clan.estado,
           ou.username,
           NULL AS sub_profile_slug,
           NULL AS specialty,
           NULL AS profession_slug,
           mc.slug AS machine_slug,
           mc.name AS machine_name,
           pr.total_points,
           pr.avg_rating,
           pr.ratings_count,
           pr.visits_count,
           pr.likes_count,
           TRUE AS is_clan,
           (SELECT COUNT(*)::int FROM tb_clan_member cm2 WHERE cm2.id_clan_profile = clan.id_profile) AS members_count
         FROM profile_ranking pr
         JOIN tb_profile clan ON clan.id_profile = pr.id_profile
         LEFT JOIN tb_machine mc ON mc.id_machine = clan.id_machine
         JOIN tb_clan_member ocm
           ON ocm.id_clan_profile = clan.id_profile AND ocm.role = 'owner'
         JOIN tb_profile op ON op.id_profile = ocm.id_member_profile
         JOIN tb_user ou ON ou.id_user = op.id_user
         WHERE clan.is_clan = TRUE
           AND clan.deleted_at IS NULL
           AND clan.is_visible = TRUE
           AND (
             -- Clan bate pela própria máquina OU pela máquina de qualquer membro.
             (
               ($1::int  IS NULL OR clan.id_machine = $1)
               AND ($3::text IS NULL OR mc.slug = $3)
             )
             OR EXISTS (
               SELECT 1 FROM tb_clan_member cmf
               JOIN tb_profile mpf ON mpf.id_profile = cmf.id_member_profile
               JOIN tb_category caf ON caf.id_category = mpf.id_category
               JOIN tb_machine  mf  ON mf.id_machine  = caf.id_machine
               WHERE cmf.id_clan_profile = clan.id_profile
                 AND ($1::int  IS NULL OR caf.id_machine = $1)
                 AND ($3::text IS NULL OR mf.slug = $3)
             )
           )
       )
       SELECT *,
              ROW_NUMBER() OVER (ORDER BY total_points DESC NULLS LAST, display_name) AS position_machine
         FROM base
        ORDER BY position_machine
        LIMIT $2`,
      [id_machine ? parseInt(id_machine, 10) : null, limit, machine_slug || null]
    );
    return this.attachXpSummaries(db, r.rows);
  },

  async getTopGeneral(db, { limit = 10 }) {
    const r = await db.query(
      `SELECT
         pro.id_profile,
         pro.display_name,
         pro.avatar_url,
         pro.municipio,
         pro.estado,
         u.username,
         pro.sub_profile_slug,
         ca.desc_category AS specialty,
         ca.profession_slug,
         m.name AS machine_name,
         m.slug AS machine_slug,
         pr.total_points,
         pr.avg_rating,
         pr.ratings_count,
         pr.visits_count,
         pr.likes_count,
         pro.is_clan,
         (SELECT COUNT(*)::int FROM tb_clan_member cm WHERE cm.id_clan_profile = pro.id_profile) AS members_count,
         pr.position_general
       FROM profile_ranking pr
       JOIN tb_profile pro ON pro.id_profile = pr.id_profile
       JOIN tb_user u ON u.id_user = pro.id_user
       LEFT JOIN tb_category ca ON ca.id_category = pro.id_category
       LEFT JOIN tb_machine m ON m.id_machine = COALESCE(ca.id_machine, pro.id_machine)
       WHERE pro.deleted_at IS NULL
       ORDER BY pr.position_general ASC NULLS LAST
       LIMIT $1`,
      [limit]
    );
    return this.attachXpSummaries(db, r.rows);
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
    return this.attachXpSummaries(db, r.rows);
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
    return this.attachXpSummaries(db, r.rows);
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
         pro.is_clan,
         (SELECT COUNT(*)::int FROM tb_clan_member cm WHERE cm.id_clan_profile = pro.id_profile) AS members_count,
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
       JOIN tb_user u ON u.id_user = pro.id_user
       LEFT JOIN tb_category ca ON ca.id_category = pro.id_category
       LEFT JOIN tb_machine m ON m.id_machine = COALESCE(ca.id_machine, pro.id_machine)
       WHERE ($1::text IS NULL OR m.slug = $1)
         AND ($2::text IS NULL OR pro.municipio ILIKE $2)
         AND ($3::int  IS NULL OR ca.id_category = $3)
       ORDER BY pr.position_general ASC NULLS LAST
       LIMIT $4 OFFSET $5`,
      [machine_slug || null, municipio || null, id_category ? parseInt(id_category) : null, limit, offset]
    );
    return this.attachXpSummaries(db, r.rows);
  },
};
