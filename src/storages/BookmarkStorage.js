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
};
