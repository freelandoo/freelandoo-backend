class BookingPayoutStorage {
  static async getByBookingId(conn, id_booking) {
    const r = await conn.query(
      `SELECT * FROM public.tb_booking_payout WHERE id_booking = $1 LIMIT 1`,
      [id_booking]
    );
    return r.rows[0] || null;
  }

  static async create(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_booking_payout (
         id_booking, id_profile, id_owner_user, id_profile_service,
         client_name, client_email, client_whatsapp,
         deposit_cents, platform_fee_cents, professional_cents, net_cents,
         status, available_at, booking_date, booking_start_time, protection_case_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id_booking) DO NOTHING
       RETURNING *`,
      [
        data.id_booking, data.id_profile, data.id_owner_user, data.id_profile_service || null,
        data.client_name || null, data.client_email || null, data.client_whatsapp || null,
        data.deposit_cents, data.platform_fee_cents || 0,
        data.professional_cents, data.net_cents,
        data.status || "aguardando", data.available_at,
        data.booking_date || null, data.booking_start_time || null,
        data.protection_case_id || null,
      ]
    );
    return r.rows[0] || null;
  }

  static async listForOwner(conn, id_owner_user, { status, limit = 100, offset = 0 } = {}) {
    const params = [id_owner_user];
    let where = "WHERE p.id_owner_user = $1";
    if (status) { params.push(status); where += ` AND p.status = $${params.length}`; }
    params.push(limit, offset);
    const r = await conn.query(
      `SELECT p.*,
              pr.display_name AS profile_display_name,
              ps.name        AS service_name
         FROM public.tb_booking_payout p
         JOIN public.tb_profile pr ON pr.id_profile = p.id_profile
         LEFT JOIN public.tb_profile_service ps ON ps.id_profile_service = p.id_profile_service
         ${where}
         ORDER BY p.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  static async listAdmin(conn, { status, q, since, until, limit = 100, offset = 0 } = {}) {
    const params = [];
    const where = ["1=1"];
    if (status)  { params.push(status); where.push(`p.status = $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(u.username ILIKE $${params.length} OR u.email ILIKE $${params.length} OR pr.display_name ILIKE $${params.length} OR p.client_name ILIKE $${params.length})`);
    }
    if (since) { params.push(since); where.push(`p.created_at >= $${params.length}`); }
    if (until) { params.push(until); where.push(`p.created_at <= $${params.length}`); }
    params.push(limit, offset);
    const r = await conn.query(
      `SELECT p.*,
              pr.display_name AS profile_display_name,
              ps.name AS service_name,
              u.username AS owner_username,
              u.email AS owner_email
         FROM public.tb_booking_payout p
         JOIN public.tb_profile pr ON pr.id_profile = p.id_profile
         LEFT JOIN public.tb_profile_service ps ON ps.id_profile_service = p.id_profile_service
         JOIN public.tb_user u ON u.id_user = p.id_owner_user
        WHERE ${where.join(" AND ")}
        ORDER BY p.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  static async releaseDue(conn) {
    const r = await conn.query(
      `UPDATE public.tb_booking_payout
          SET status = 'aprovado', approved_at = NOW(), updated_at = NOW()
        WHERE status = 'aguardando' AND available_at <= NOW()
        RETURNING id_payout, id_owner_user`
    );
    return r.rows;
  }

  static async markPaidOut(conn, id_payout, { note } = {}) {
    const r = await conn.query(
      `UPDATE public.tb_booking_payout
          SET status = 'pago', paid_out_at = NOW(), paid_out_note = $2, updated_at = NOW()
        WHERE id_payout = $1 AND status = 'aprovado'
        RETURNING *`,
      [id_payout, note || null]
    );
    return r.rows[0] || null;
  }

  static async revertByBooking(conn, id_booking) {
    const r = await conn.query(
      `UPDATE public.tb_booking_payout
          SET status = 'revertido', reverted_at = NOW(), updated_at = NOW()
        WHERE id_booking = $1 AND status IN ('aguardando','aprovado')
        RETURNING *`,
      [id_booking]
    );
    return r.rows[0] || null;
  }
}

module.exports = BookingPayoutStorage;
