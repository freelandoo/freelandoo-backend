// Imagens editáveis das home (mig 130). slot_key -> image_url no R2.
class SiteAssetStorage {
  static async listAll(conn) {
    const r = await conn.query(
      `SELECT slot_key, image_url FROM public.tb_site_asset`
    );
    const map = {};
    for (const row of r.rows) map[row.slot_key] = row.image_url;
    return map;
  }

  static async upsert(conn, { slot_key, image_url, updated_by }) {
    const r = await conn.query(
      `INSERT INTO public.tb_site_asset (slot_key, image_url, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (slot_key) DO UPDATE
         SET image_url = EXCLUDED.image_url,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
       RETURNING slot_key, image_url`,
      [slot_key, image_url, updated_by || null]
    );
    return r.rows[0];
  }

  static async remove(conn, slot_key) {
    await conn.query(`DELETE FROM public.tb_site_asset WHERE slot_key = $1`, [
      slot_key,
    ]);
    return true;
  }
}

module.exports = SiteAssetStorage;
