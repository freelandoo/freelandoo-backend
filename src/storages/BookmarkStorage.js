const DEFAULT_FOLDER = "Assistir depois";

async function ensureDefaultFolder(db, id_user) {
  const r = await db.query(
    `INSERT INTO user_bookmark_folder (id_user, name, sort_order)
     VALUES ($1, $2, 0)
     ON CONFLICT (id_user, name) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [id_user, DEFAULT_FOLDER]
  );
  return r.rows[0];
}

module.exports = {
  async listFolders(db, id_user) {
    await ensureDefaultFolder(db, id_user);
    const r = await db.query(
      `SELECT
         f.*,
         COUNT(b.id_bookmark)::int AS items_count
       FROM user_bookmark_folder f
       LEFT JOIN user_bookmark_item b ON b.id_folder = f.id_folder
       WHERE f.id_user = $1
       GROUP BY f.id_folder
       ORDER BY f.sort_order, f.created_at`,
      [id_user]
    );
    return r.rows;
  },

  async createFolder(db, { id_user, name }) {
    const clean = String(name || "").trim().slice(0, 80);
    if (!clean) {
      const err = new Error("Nome da pasta obrigatorio");
      err.statusCode = 400;
      throw err;
    }
    const r = await db.query(
      `INSERT INTO user_bookmark_folder (id_user, name)
       VALUES ($1, $2)
       ON CONFLICT (id_user, name) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [id_user, clean]
    );
    return r.rows[0];
  },

  async toggle(db, { id_user, id_portfolio_item, id_folder }) {
    const existing = await db.query(
      `SELECT id_bookmark
         FROM user_bookmark_item
        WHERE id_user = $1 AND id_portfolio_item = $2`,
      [id_user, id_portfolio_item]
    );

    if (existing.rows.length) {
      await db.query(
        `DELETE FROM user_bookmark_item WHERE id_bookmark = $1`,
        [existing.rows[0].id_bookmark]
      );
      return { bookmarked: false };
    }

    let folderId = id_folder || null;
    if (!folderId) {
      folderId = (await ensureDefaultFolder(db, id_user)).id_folder;
    }

    const r = await db.query(
      `INSERT INTO user_bookmark_item (id_user, id_folder, id_portfolio_item)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_user, id_portfolio_item) DO NOTHING
       RETURNING id_bookmark`,
      [id_user, folderId, id_portfolio_item]
    );
    return { bookmarked: r.rows.length > 0, id_folder: folderId };
  },

  async status(db, { id_user, ids }) {
    if (!ids.length) return [];
    const r = await db.query(
      `SELECT id_portfolio_item
         FROM user_bookmark_item
        WHERE id_user = $1 AND id_portfolio_item = ANY($2::uuid[])`,
      [id_user, ids]
    );
    return r.rows.map((row) => row.id_portfolio_item);
  },

  async listMine(db, { id_user, kind = null, limit = 24, offset = 0 }) {
    const kindFilter = kind && (kind === "feed" || kind === "bees")
      ? "AND ppi.feed_kind = $4"
      : "";
    const params = [id_user, limit, offset];
    if (kindFilter) params.push(kind);

    const sql = `
      SELECT
        b.id_bookmark::text                          AS id_bookmark,
        b.created_at                                 AS bookmarked_at,
        ppi.id_portfolio_item::text                  AS post_id,
        ppi.title,
        ppi.feed_kind,
        ppi.published_at,
        ppi.likes_count,
        pro.id_profile::text                         AS id_profile,
        pro.display_name,
        pro.avatar_url,
        pro.is_clan,
        tu.username,
        m.color_accent,
        m.name                                       AS machine_name,
        (
          SELECT jsonb_build_object(
            'url', ppm.media_url,
            'type', ppm.media_type,
            'thumbnail_url', ppm.thumbnail_url
          )
          FROM public.tb_profile_portfolio_media ppm
          WHERE ppm.id_portfolio_item = ppi.id_portfolio_item
          ORDER BY ppm.sort_order, ppm.created_at
          LIMIT 1
        )                                            AS first_media
        FROM public.user_bookmark_item b
        JOIN public.tb_profile_portfolio_item ppi
          ON ppi.id_portfolio_item = b.id_portfolio_item
        JOIN public.tb_profile pro   ON pro.id_profile = ppi.id_profile
        JOIN public.tb_user    tu    ON tu.id_user     = pro.id_user
        LEFT JOIN public.tb_category ca ON ca.id_category = pro.id_category
        LEFT JOIN public.tb_machine  m  ON m.id_machine  = COALESCE(ca.id_machine, pro.id_machine)
       WHERE b.id_user = $1
         AND ppi.is_active = TRUE
         AND ppi.is_banned = FALSE
         ${kindFilter}
       ORDER BY b.created_at DESC
       LIMIT $2 OFFSET $3
    `;
    const countParams = [id_user];
    const countSql = `
      SELECT COUNT(*)::int AS c
        FROM public.user_bookmark_item b
        JOIN public.tb_profile_portfolio_item ppi
          ON ppi.id_portfolio_item = b.id_portfolio_item
       WHERE b.id_user = $1
         AND ppi.is_active = TRUE
         AND ppi.is_banned = FALSE
         ${kindFilter ? "AND ppi.feed_kind = $2" : ""}
    `;
    if (kindFilter) countParams.push(kind);

    const [rows, count] = await Promise.all([
      db.query(sql, params),
      db.query(countSql, countParams),
    ]);
    return { items: rows.rows, total: count.rows[0]?.c || 0 };
  },
};
