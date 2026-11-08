// src/storages/BeeEngagementStorage.js
// Engajamento do bee (story) — espelho enxuto de RankingStorage.toggleLike +
// PortfolioCommentStorage + PostReportStorage, chaveado em tb_story.
//
// FÓRMULA DO SCORE DO BEE (constante única — a vida do bee deriva dela):
//   engagement_score = likes*1 + comments*2 + shares*3
// Comentário PONTUA no bee (diferente do post) porque é o principal sinal da
// extensão de vida 24h→7d. Impressões não pontuam (sinal de distribuição).
const SCORE_SQL = `
  GREATEST(likes_count, 0)    * 1
+ GREATEST(comments_count, 0) * 2
+ GREATEST(shares_count, 0)   * 3
`;

// Visibilidade efetiva do bee: pelo EMBALO (mig 420, regra em utils/beeLife.js) —
// 24 h de carência e depois fica enquanto continua crescendo, sem teto.
// Inclui o deleted_at — substitui o par "deleted_at IS NULL AND expires_at > NOW()".
const { BEE_ALIVE_SQL } = require("../utils/beeLife");

const SHARE_DEDUP_INTERVAL = "30 minutes";

// Alcance regional (mig 328). require tardio nas funções: ReachStorage
// também puxa esta classe.
const reach = () => require("./ReachStorage");
const REACH_BY_COUNTER = { likes_count: "like", comments_count: "comment" };

class BeeEngagementStorage {
  // Incrementa um contador e recalcula o engagement_score na mesma transação.
  // counterColumn passa por whitelist antes de interpolar.
  static async _bumpCounter(client, id_story, counterColumn, delta, who = null) {
    const allowed = new Set(["likes_count", "comments_count", "shares_count", "impressions_count"]);
    if (!allowed.has(counterColumn)) throw new Error(`counter inválido: ${counterColumn}`);
    await client.query(
      `UPDATE public.tb_story
          SET ${counterColumn} = GREATEST(${counterColumn} + $2, 0)
        WHERE id_story = $1`,
      [id_story, delta]
    );
    // Curtida ±5 e comentário ±10 no alcance, na mesma transação.
    if (REACH_BY_COUNTER[counterColumn] && delta) {
      await reach().addWeighted(client, "bee", id_story, REACH_BY_COUNTER[counterColumn], delta, who);
    }
    const { rows } = await client.query(
      `UPDATE public.tb_story
          SET engagement_score = ${SCORE_SQL}
        WHERE id_story = $1
        RETURNING likes_count, comments_count, shares_count, impressions_count, engagement_score`,
      [id_story]
    );
    return rows[0] || null;
  }

  static async toggleLike(pool, { id_story, id_user }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        `SELECT 1 FROM public.tb_story_like WHERE id_story = $1 AND id_user = $2`,
        [id_story, id_user]
      );
      let liked;
      if (existing.rows.length > 0) {
        await client.query(
          `DELETE FROM public.tb_story_like WHERE id_story = $1 AND id_user = $2`,
          [id_story, id_user]
        );
        liked = false;
      } else {
        await client.query(
          `INSERT INTO public.tb_story_like (id_story, id_user) VALUES ($1, $2)`,
          [id_story, id_user]
        );
        liked = true;
      }
      const counters = await BeeEngagementStorage._bumpCounter(
        client, id_story, "likes_count", liked ? 1 : -1, { actor: id_user }
      );
      if (liked) await reach().removeDislike(client, "bee", id_story, id_user);
      await client.query("COMMIT");
      return { liked, likes_count: counters?.likes_count ?? null };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Comentários ───────────────────────────────────────────────────────────
  static async listComments(conn, { id_story, cursor, limit, viewer_id_user }) {
    const params = [id_story, limit];
    let cursorClause = "";
    if (cursor) {
      params.push(cursor);
      cursorClause = `AND sc.created_at < $${params.length}`;
    }
    let viewerSelect = "FALSE AS viewer_has_liked";
    if (viewer_id_user) {
      params.push(viewer_id_user);
      viewerSelect = `EXISTS (
        SELECT 1 FROM public.tb_story_comment_like scl
         WHERE scl.id_story_comment = sc.id_story_comment
           AND scl.id_user = $${params.length}
      ) AS viewer_has_liked`;
    }
    const { rows } = await conn.query(
      `SELECT sc.id_story_comment, sc.id_story, sc.id_user, sc.content,
              sc.created_at, sc.updated_at, sc.likes_count,
              ${viewerSelect},
              u.username, u.display_name AS user_display_name, u.avatar_url AS user_avatar_url
         FROM public.tb_story_comment sc
         JOIN public.tb_user u ON u.id_user = sc.id_user
        WHERE sc.id_story = $1
          AND sc.is_active = TRUE
          ${cursorClause}
        ORDER BY sc.created_at DESC
        LIMIT $2`,
      params
    );
    return rows;
  }

  static async createComment(client, { id_story, id_user, content }) {
    const { rows } = await client.query(
      `INSERT INTO public.tb_story_comment (id_story, id_user, content)
       VALUES ($1, $2, $3)
       RETURNING id_story_comment, id_story, id_user, content, created_at, updated_at, likes_count`,
      [id_story, id_user, content]
    );
    return rows[0];
  }

  static async getCommentById(conn, id_story_comment) {
    const { rows } = await conn.query(
      `SELECT sc.*, u.username, u.display_name AS user_display_name, u.avatar_url AS user_avatar_url
         FROM public.tb_story_comment sc
         JOIN public.tb_user u ON u.id_user = sc.id_user
        WHERE sc.id_story_comment = $1 AND sc.is_active = TRUE
        LIMIT 1`,
      [id_story_comment]
    );
    return rows[0] || null;
  }

  static async deactivateComment(client, id_story_comment) {
    const { rows } = await client.query(
      `UPDATE public.tb_story_comment
          SET is_active = FALSE, updated_at = NOW()
        WHERE id_story_comment = $1 AND is_active = TRUE
        RETURNING id_story_comment, id_story`,
      [id_story_comment]
    );
    return rows[0] || null;
  }

  static async toggleCommentLike(pool, { id_story_comment, id_user }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        `SELECT 1 FROM public.tb_story_comment_like WHERE id_story_comment = $1 AND id_user = $2`,
        [id_story_comment, id_user]
      );
      let liked;
      if (existing.rows.length > 0) {
        await client.query(
          `DELETE FROM public.tb_story_comment_like WHERE id_story_comment = $1 AND id_user = $2`,
          [id_story_comment, id_user]
        );
        liked = false;
      } else {
        await client.query(
          `INSERT INTO public.tb_story_comment_like (id_story_comment, id_user) VALUES ($1, $2)`,
          [id_story_comment, id_user]
        );
        liked = true;
      }
      const upd = await client.query(
        `UPDATE public.tb_story_comment
            SET likes_count = GREATEST(likes_count + $2, 0)
          WHERE id_story_comment = $1
          RETURNING likes_count`,
        [id_story_comment, liked ? 1 : -1]
      );
      await client.query("COMMIT");
      return { liked, likes_count: upd.rows[0]?.likes_count ?? 0 };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Denúncia ──────────────────────────────────────────────────────────────
  static async createReport(conn, { id_story, reporter_user_id, reason_category, reason }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_story_report (id_story, reporter_user_id, reason_category, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id_story, reporter_user_id) DO NOTHING
       RETURNING id_story_report`,
      [id_story, reporter_user_id, reason_category, reason]
    );
    return rows[0] || null; // null = já tinha denunciado
  }

  static async adminListReported(conn, { limit = 50 }) {
    const { rows } = await conn.query(
      `SELECT s.id_story, s.caption, s.thumbnail_url, s.video_url, s.created_at,
              s.deleted_at, s.likes_count, s.comments_count,
              p.display_name AS profile_display_name, u.username,
              COUNT(r.id_story_report)::int AS reports_count,
              MAX(r.created_at) AS last_reported_at,
              ARRAY_AGG(DISTINCT r.reason_category) AS categories
         FROM public.tb_story_report r
         JOIN public.tb_story s ON s.id_story = r.id_story
         JOIN public.tb_profile p ON p.id_profile = s.id_profile
         JOIN public.tb_user u ON u.id_user = s.id_user
        WHERE r.resolved_at IS NULL
        GROUP BY s.id_story, p.display_name, u.username
        ORDER BY MAX(r.created_at) DESC
        LIMIT $1`,
      [limit]
    );
    return rows;
  }

  static async adminResolveReports(conn, { id_story }) {
    await conn.query(
      `UPDATE public.tb_story_report SET resolved_at = NOW()
        WHERE id_story = $1 AND resolved_at IS NULL`,
      [id_story]
    );
  }

  static async adminSoftDeleteStory(conn, { id_story }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_story SET deleted_at = NOW()
        WHERE id_story = $1 AND deleted_at IS NULL
        RETURNING id_story`,
      [id_story]
    );
    return rows[0] || null;
  }

  // ── Bookmark (Salvos) ─────────────────────────────────────────────────────
  // Salvar vale 30 no alcance (desfazer devolve) — transação própria.
  static async toggleBookmark(pool, { id_story, id_user }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const del = await client.query(
        `DELETE FROM public.tb_story_bookmark WHERE id_story = $1 AND id_user = $2 RETURNING 1`,
        [id_story, id_user]
      );
      let bookmarked;
      if (del.rows.length > 0) {
        bookmarked = false;
        await reach().addWeighted(client, "bee", id_story, "save", -1);
      } else {
        const ins = await client.query(
          `INSERT INTO public.tb_story_bookmark (id_story, id_user) VALUES ($1, $2)
           ON CONFLICT DO NOTHING RETURNING 1`,
          [id_story, id_user]
        );
        bookmarked = true;
        if (ins.rows.length) await reach().addWeighted(client, "bee", id_story, "save", 1);
      }
      await client.query("COMMIT");
      return { bookmarked };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Eventos (share) — dedupe por sessão em 30min, espelho do feed ─────────
  static async recordEvent(pool, { id_story, id_user, session_id, event_type }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let counts = true;
      if (session_id) {
        const dup = await client.query(
          `SELECT 1 FROM public.tb_story_event
            WHERE id_story = $1 AND session_id = $2 AND event_type = $3
              AND created_at >= NOW() - INTERVAL '${SHARE_DEDUP_INTERVAL}'
            LIMIT 1`,
          [id_story, session_id, event_type]
        );
        if (dup.rows.length) counts = false;
      }
      await client.query(
        `INSERT INTO public.tb_story_event (id_story, id_user, session_id, event_type)
         VALUES ($1, $2, $3, $4)`,
        [id_story, id_user || null, session_id || null, event_type]
      );
      if (counts && event_type === "share") {
        await BeeEngagementStorage._bumpCounter(client, id_story, "shares_count", 1);
      }
      // Alcance: compartilhamento vale uma vez por pessoa, × velocidade.
      if (event_type === "share") {
        await reach().recordUnique(client, "bee", id_story, { id_user, session_id }, "share");
      }
      await client.query("COMMIT");
      return { ok: true, counted: counts };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = BeeEngagementStorage;
module.exports.BEE_ALIVE_SQL = BEE_ALIVE_SQL;
module.exports.SCORE_SQL = SCORE_SQL;
