// Aceite de termos por ação crítica (mig 129). Guarda o aceite mais recente por
// (usuário, ação), com versão e prova (ip/user_agent).
class ConsentStorage {
  static async listForUser(conn, id_user) {
    const r = await conn.query(
      `SELECT action_key, terms_version
         FROM public.tb_user_action_consent
        WHERE id_user = $1`,
      [id_user]
    );
    const map = {};
    for (const row of r.rows) map[row.action_key] = row.terms_version;
    return map;
  }

  static async upsert(conn, { id_user, action_key, terms_version, ip, user_agent }) {
    const r = await conn.query(
      `INSERT INTO public.tb_user_action_consent
         (id_user, action_key, terms_version, accepted_at, ip, user_agent)
       VALUES ($1, $2, $3, NOW(), $4, $5)
       ON CONFLICT (id_user, action_key) DO UPDATE
         SET terms_version = EXCLUDED.terms_version,
             accepted_at   = NOW(),
             ip            = EXCLUDED.ip,
             user_agent    = EXCLUDED.user_agent
       RETURNING action_key, terms_version, accepted_at`,
      [id_user, action_key, terms_version, ip || null, user_agent || null]
    );
    return r.rows[0];
  }
}

module.exports = ConsentStorage;
