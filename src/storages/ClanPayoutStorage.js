// Saldo de split de clan (mig 126). N linhas por venda — uma por perfil anexado.
// Espelha a lifecycle do tb_booking_payout (aguardando→aprovado→pago→revertido).
class ClanPayoutStorage {
  static async existsForSource(conn, source_type, source_id) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_clan_payout
        WHERE source_type = $1 AND source_id = $2 LIMIT 1`,
      [source_type, String(source_id)]
    );
    return r.rowCount > 0;
  }

  /**
   * Cria os splits de uma venda. `rows` = [{id_member_profile, id_owner_user, amount_cents}].
   * Holdback de 8 dias. Idempotente por (source_type, source_id, id_member_profile).
   */
  static async createSplits(conn, { id_clan_profile, source_type, source_id, gross_cents, rows }) {
    if (!rows || rows.length === 0) return [];
    const values = [];
    const params = [];
    let i = 1;
    for (const { id_member_profile, id_owner_user, amount_cents } of rows) {
      values.push(
        `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, NOW() + INTERVAL '8 days')`
      );
      params.push(
        id_clan_profile,
        id_member_profile,
        id_owner_user,
        source_type,
        String(source_id),
        gross_cents,
        amount_cents
      );
    }
    const r = await conn.query(
      `INSERT INTO public.tb_clan_payout
         (id_clan_profile, id_member_profile, id_owner_user, source_type, source_id,
          gross_cents, amount_cents, available_at)
       VALUES ${values.join(", ")}
       ON CONFLICT (source_type, source_id, id_member_profile) DO NOTHING
       RETURNING id_clan_payout, id_member_profile, amount_cents`,
      params
    );
    return r.rows;
  }

  static async listForOwner(conn, id_owner_user, { status, limit = 100, offset = 0 } = {}) {
    const params = [id_owner_user];
    let where = "WHERE cp.id_owner_user = $1";
    if (status) { params.push(status); where += ` AND cp.status = $${params.length}`; }
    params.push(limit, offset);
    const r = await conn.query(
      `SELECT cp.*,
              clan.display_name AS clan_display_name,
              mp.display_name   AS member_display_name
         FROM public.tb_clan_payout cp
         JOIN public.tb_profile clan ON clan.id_profile = cp.id_clan_profile
         LEFT JOIN public.tb_profile mp ON mp.id_profile = cp.id_member_profile
         ${where}
         ORDER BY cp.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  static async summaryForOwner(conn, id_owner_user) {
    const r = await conn.query(
      `SELECT
          COALESCE(SUM(CASE WHEN status='aguardando' THEN amount_cents END), 0) AS aguardando_cents,
          COALESCE(SUM(CASE WHEN status='aprovado'   THEN amount_cents END), 0) AS aprovado_cents,
          COALESCE(SUM(CASE WHEN status='pago'       THEN amount_cents END), 0) AS pago_cents,
          COALESCE(SUM(CASE WHEN status='revertido'  THEN amount_cents END), 0) AS revertido_cents
         FROM public.tb_clan_payout
        WHERE id_owner_user = $1`,
      [id_owner_user]
    );
    return r.rows[0];
  }

  static async releaseDue(conn) {
    const r = await conn.query(
      `UPDATE public.tb_clan_payout
          SET status='aprovado', approved_at=NOW(), updated_at=NOW()
        WHERE status='aguardando' AND available_at <= NOW()
        RETURNING id_clan_payout, id_owner_user`
    );
    return r.rows;
  }

  static async revertBySource(conn, source_type, source_id) {
    const r = await conn.query(
      `UPDATE public.tb_clan_payout
          SET status='revertido', reverted_at=NOW(), updated_at=NOW()
        WHERE source_type=$1 AND source_id=$2 AND status IN ('aguardando','aprovado')
        RETURNING id_clan_payout`,
      [source_type, String(source_id)]
    );
    return r.rows;
  }
}

module.exports = ClanPayoutStorage;
