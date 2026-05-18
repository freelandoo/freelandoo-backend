// src/storages/CountryStorage.js
module.exports = {
  async listActive(db) {
    const r = await db.query(
      `SELECT iso2, iso3, name_pt, name_en, name_es,
              default_locale, currency, display_order
         FROM public.tb_country
        WHERE is_active = TRUE
        ORDER BY display_order ASC, name_pt ASC`
    );
    return r.rows;
  },

  async findByIso2(db, iso2) {
    if (!iso2) return null;
    const r = await db.query(
      `SELECT iso2, iso3, name_pt, name_en, name_es,
              default_locale, currency, is_active
         FROM public.tb_country
        WHERE iso2 = UPPER($1)
        LIMIT 1`,
      [iso2]
    );
    return r.rows[0] || null;
  },
};
