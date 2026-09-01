// src/storages/CommunityDomainStorage.js
// SQL puro do domínio próprio (mig 214).

class CommunityDomainStorage {
  static async listByProfile(conn, id_profile) {
    const r = await conn.query(
      `SELECT id_domain, id_profile, domain, status, verification_token,
              verified_at, provider, provider_state, last_error, last_checked_at,
              created_at, updated_at
         FROM public.tb_community_domain
        WHERE id_profile = $1
        ORDER BY created_at DESC`,
      [id_profile]
    );
    return r.rows;
  }

  static async getById(conn, id_domain) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_domain WHERE id_domain = $1 LIMIT 1`,
      [id_domain]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getByDomain(conn, domain) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_domain WHERE domain = $1 LIMIT 1`,
      [domain]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async countByProfile(conn, id_profile) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_community_domain WHERE id_profile = $1`,
      [id_profile]
    );
    return r.rows[0].n;
  }

  /**
   * Cria o pedido. A unicidade global é do BANCO — dois líderes reivindicando
   * o mesmo domínio ao mesmo tempo passariam os dois por um "já existe?" e
   * colidiriam só no INSERT. O 23505 vira `{ taken: true }`: para quem chamou é
   * uma resposta ("esse domínio já é de outra comunidade"), não uma exceção.
   */
  static async create(conn, { id_profile, domain, token, provider }) {
    try {
      const r = await conn.query(
        `INSERT INTO public.tb_community_domain
                (id_profile, domain, verification_token, provider)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [id_profile, domain, token, provider]
      );
      return r.rows[0];
    } catch (err) {
      if (err && err.code === "23505") return { taken: true };
      throw err;
    }
  }

  /**
   * Grava o resultado de uma checagem.
   *
   * `verified_at` usa COALESCE para preservar a PRIMEIRA verificação: é a data
   * em que a posse foi provada, não a da última vez que alguém apertou o botão.
   * Recalcular a cada checagem apagaria a única informação que diz há quanto
   * tempo aquele domínio é confiável.
   */
  static async updateState(
    conn,
    id_domain,
    { status, verified, provider_state, last_error }
  ) {
    const r = await conn.query(
      `UPDATE public.tb_community_domain
          SET status          = $2,
              verified_at     = CASE WHEN $3 = TRUE
                                     THEN COALESCE(verified_at, NOW())
                                     ELSE verified_at END,
              provider_state  = COALESCE($4::jsonb, provider_state),
              last_error      = $5,
              last_checked_at = NOW(),
              updated_at      = NOW()
        WHERE id_domain = $1
      RETURNING *`,
      [
        id_domain,
        status,
        verified === true,
        provider_state ? JSON.stringify(provider_state) : null,
        last_error || null,
      ]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async remove(conn, id_domain) {
    const r = await conn.query(
      `DELETE FROM public.tb_community_domain WHERE id_domain = $1 RETURNING domain`,
      [id_domain]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Resolução por Host — o caminho quente: roda a cada visita vinda de domínio
   * próprio. Só devolve o que está ATIVO e com site PUBLICADO, e já traz o slug
   * para o roteamento não precisar de uma segunda consulta.
   */
  static async resolveActive(conn, domain) {
    const r = await conn.query(
      `SELECT d.domain, d.id_profile, p.community_site_slug AS slug
         FROM public.tb_community_domain d
         JOIN public.tb_profile p ON p.id_profile = d.id_profile
         JOIN public.tb_community_site cs ON cs.id_profile = d.id_profile
        WHERE d.domain = $1
          AND d.status = 'active'
          AND cs.is_published = TRUE
          AND p.deleted_at IS NULL
        LIMIT 1`,
      [domain]
    );
    return r.rowCount ? r.rows[0] : null;
  }
}

module.exports = CommunityDomainStorage;
