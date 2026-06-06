// Textos editáveis das home (mig 131). slot_key -> content.
class SiteTextStorage {
  static async listAll(conn) {
    const r = await conn.query(
      `SELECT slot_key, content FROM public.tb_site_text`
    );
    const map = {};
    for (const row of r.rows) map[row.slot_key] = row.content;
    return map;
  }

  static async upsert(conn, { slot_key, content, updated_by }) {
    const r = await conn.query(
      `INSERT INTO public.tb_site_text (slot_key, content, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (slot_key) DO UPDATE
         SET content = EXCLUDED.content,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
       RETURNING slot_key, content`,
      [slot_key, content, updated_by || null]
    );
    return r.rows[0];
  }
}

module.exports = SiteTextStorage;
