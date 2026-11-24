// src/storages/CityPrefStorage.js
// Minha cidade (mig 468): a preferência de moradia de cada pessoa.

class CityPrefStorage {
  static async get(conn, id_user) {
    const r = await conn.query(
      `SELECT housing_kind, last_tab, updated_at
         FROM public.tb_user_city_pref
        WHERE id_user = $1`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  /**
   * Grava só o que veio (parcial). Upsert numa instrução: dois PUTs ao mesmo
   * tempo (aba trocada em dois aparelhos) não brigam por chave duplicada.
   */
  static async upsert(conn, id_user, { housing_kind, last_tab }) {
    const r = await conn.query(
      `INSERT INTO public.tb_user_city_pref (id_user, housing_kind, last_tab, updated_at)
            VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id_user) DO UPDATE
             SET housing_kind = COALESCE(EXCLUDED.housing_kind, tb_user_city_pref.housing_kind),
                 last_tab     = COALESCE(EXCLUDED.last_tab, tb_user_city_pref.last_tab),
                 updated_at   = NOW()
       RETURNING housing_kind, last_tab, updated_at`,
      [id_user, housing_kind ?? null, last_tab ?? null]
    );
    return r.rows[0];
  }
}

module.exports = CityPrefStorage;
