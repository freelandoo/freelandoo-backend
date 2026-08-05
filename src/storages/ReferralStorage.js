/**
 * Vínculo vitalício de indicação (mig 193).
 *
 * 1 linha por usuário indicado (UNIQUE em id_user_referred). O vínculo nasce na
 * primeira compra de PLATAFORMA feita com cupom e nunca é sobrescrito.
 */
class ReferralStorage {
  /**
   * Vínculo VIVO do usuário: não liberado, não expirado e com o afiliado ainda
   * ACTIVE. Afiliado pausado/bloqueado faz o vínculo dormir (não paga) sem
   * apagar a linha — se reativar, volta sozinho.
   */
  static async getActiveByUser(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT r.*, a.id_user AS affiliate_user_id, a.status AS affiliate_status
         FROM public.tb_user_referral r
         JOIN public.tb_affiliate a ON a.id_affiliate = r.id_affiliate
        WHERE r.id_user_referred = $1
          AND r.released_at IS NULL
          AND (r.expires_at IS NULL OR r.expires_at > NOW())
          AND a.status = 'ACTIVE'
          AND a.is_active = TRUE
        LIMIT 1`,
      [id_user]
    );
    return rows[0] || null;
  }

  /** Qualquer vínculo do usuário, vivo ou não — para o admin e para não re-vincular. */
  static async getAnyByUser(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_user_referral WHERE id_user_referred = $1 LIMIT 1`,
      [id_user]
    );
    return rows[0] || null;
  }

  /**
   * Cria o vínculo. ON CONFLICT DO NOTHING garante que o PRIMEIRO vence mesmo
   * em corrida entre dois webhooks — devolve null quando já existia.
   */
  static async create(conn, {
    id_user_referred,
    id_affiliate,
    id_coupon = null,
    bound_source = "first_purchase",
    id_first_order = null,
  }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_user_referral
         (id_user_referred, id_affiliate, id_coupon, bound_source, id_first_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id_user_referred) DO NOTHING
       RETURNING *`,
      [id_user_referred, id_affiliate, id_coupon, bound_source, id_first_order]
    );
    return rows[0] || null;
  }

  static async release(conn, { id_referral, reason = null, released_by = null }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_user_referral
          SET released_at = NOW(), released_reason = $2, released_by = $3
        WHERE id_referral = $1
          AND released_at IS NULL
        RETURNING *`,
      [id_referral, reason, released_by]
    );
    return rows[0] || null;
  }

  /** Indicados de um afiliado — alimenta a tela "Meus indicados" (slice X3). */
  static async listByAffiliate(conn, id_affiliate, { limit = 50, offset = 0 } = {}) {
    const { rows } = await conn.query(
      `SELECT r.*, u.username, u.nome AS display_name
         FROM public.tb_user_referral r
         JOIN public.tb_user u ON u.id_user = r.id_user_referred
        WHERE r.id_affiliate = $1
          AND r.released_at IS NULL
        ORDER BY r.bound_at DESC
        LIMIT $2 OFFSET $3`,
      [id_affiliate, limit, offset]
    );
    return rows;
  }

  static async countByAffiliate(conn, id_affiliate) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS total
         FROM public.tb_user_referral
        WHERE id_affiliate = $1 AND released_at IS NULL`,
      [id_affiliate]
    );
    return rows[0]?.total || 0;
  }

  /** CPF do titular — usado na trava anti-fraude de auto-indicação (mig 188). */
  static async getUserCpf(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT cpf FROM public.tb_user WHERE id_user = $1 LIMIT 1`,
      [id_user]
    );
    return rows[0]?.cpf || null;
  }
}

module.exports = ReferralStorage;
