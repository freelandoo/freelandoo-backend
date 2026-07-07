// src/storages/AcademySocialStorage.js
// Persistência do social da academia (mig 179): posts, metas e ranking mensal.
module.exports = {
  // ─── Posts ─────────────────────────────────────────────────────────────────
  async createPost(db, p) {
    const r = await db.query(
      `INSERT INTO public.tb_academy_post
         (id_academy, id_user, caption, media_url, thumbnail_url, media_kind)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [p.id_academy, p.id_user, p.caption || null, p.media_url || null, p.thumbnail_url || null, p.media_kind || null]
    );
    return r.rows[0];
  },

  async getPostById(db, id_post) {
    const r = await db.query(
      `SELECT * FROM public.tb_academy_post WHERE id_post = $1 AND deleted_at IS NULL`,
      [id_post]
    );
    return r.rows[0] || null;
  },

  async listPosts(db, id_academy, { limit = 20, before } = {}) {
    const vals = [id_academy];
    let cursorClause = "";
    if (before) {
      vals.push(before);
      cursorClause = `AND p.created_at < $${vals.length}`;
    }
    vals.push(limit);
    const r = await db.query(
      `SELECT p.*, u.username, u.nome AS user_nome
         FROM public.tb_academy_post p
         JOIN public.tb_user u ON u.id_user = p.id_user
        WHERE p.id_academy = $1 AND p.deleted_at IS NULL ${cursorClause}
        ORDER BY p.created_at DESC
        LIMIT $${vals.length}`,
      vals
    );
    return r.rows;
  },

  async softDeletePost(db, id_post) {
    await db.query(`UPDATE public.tb_academy_post SET deleted_at = NOW() WHERE id_post = $1`, [id_post]);
  },

  async incrementShare(db, id_post) {
    const r = await db.query(
      `UPDATE public.tb_academy_post SET share_count = share_count + 1
        WHERE id_post = $1 AND deleted_at IS NULL RETURNING share_count`,
      [id_post]
    );
    return r.rows[0] ? r.rows[0].share_count : null;
  },

  // ─── Metas ─────────────────────────────────────────────────────────────────
  async getGoals(db, id_academy) {
    const r = await db.query(`SELECT * FROM public.tb_academy_goal WHERE id_academy = $1`, [id_academy]);
    return (
      r.rows[0] || { id_academy, freq_target_month: 12, posts_target_month: 4, shares_target_month: 4 }
    );
  },

  async setGoals(db, id_academy, { freq_target_month, posts_target_month, shares_target_month }) {
    const r = await db.query(
      `INSERT INTO public.tb_academy_goal (id_academy, freq_target_month, posts_target_month, shares_target_month)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id_academy) DO UPDATE SET
         freq_target_month = EXCLUDED.freq_target_month,
         posts_target_month = EXCLUDED.posts_target_month,
         shares_target_month = EXCLUDED.shares_target_month,
         updated_at = NOW()
       RETURNING *`,
      [id_academy, freq_target_month, posts_target_month, shares_target_month]
    );
    return r.rows[0];
  },

  // ─── Ranking mensal ────────────────────────────────────────────────────────
  // Por membro vinculado: dias distintos de catraca, posts e shares recebidos
  // dentro do mês [monthStart, nextMonth).
  async monthlyRanking(db, id_academy, monthStart, nextMonth) {
    const r = await db.query(
      `SELECT m.id_member, m.id_user, u.username, u.nome AS user_nome, m.member_name,
              COALESCE(freq.days, 0)::int AS freq_days,
              COALESCE(posts.n, 0)::int AS posts_count,
              COALESCE(shares.n, 0)::int AS shares_count
         FROM public.tb_academy_member m
         JOIN public.tb_user u ON u.id_user = m.id_user
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT ev.occurred_at::date) AS days
             FROM public.tb_academy_access_event ev
            WHERE ev.id_member = m.id_member
              AND ev.occurred_at >= $2::date AND ev.occurred_at < $3::date
         ) freq ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS n
             FROM public.tb_academy_post p
            WHERE p.id_academy = m.id_academy AND p.id_user = m.id_user
              AND p.deleted_at IS NULL
              AND p.created_at >= $2::date AND p.created_at < $3::date
         ) posts ON TRUE
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(p.share_count), 0) AS n
             FROM public.tb_academy_post p
            WHERE p.id_academy = m.id_academy AND p.id_user = m.id_user
              AND p.deleted_at IS NULL
              AND p.created_at >= $2::date AND p.created_at < $3::date
         ) shares ON TRUE
        WHERE m.id_academy = $1
        ORDER BY freq_days DESC, posts_count DESC, u.nome ASC NULLS LAST`,
      [id_academy, monthStart, nextMonth]
    );
    return r.rows;
  },
};
