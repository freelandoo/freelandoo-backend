class BookingStorage {
  static async create(conn, {
    id_profile, profile_owner_user_id, client_name, client_email, client_whatsapp,
    booking_date, start_time, end_time,
    deposit_amount, platform_fee_amount, professional_amount,
    stripe_checkout_session_id
  }) {
    const r = await conn.query(
      `INSERT INTO public.tb_profile_bookings
        (id_profile, profile_owner_user_id, client_name, client_email, client_whatsapp,
         booking_date, start_time, end_time,
         deposit_amount, platform_fee_amount, professional_amount,
         stripe_checkout_session_id, status, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending_payment','pending')
       RETURNING *`,
      [id_profile, profile_owner_user_id, client_name, client_email, client_whatsapp,
       booking_date, start_time, end_time,
       deposit_amount, platform_fee_amount, professional_amount,
       stripe_checkout_session_id]
    );
    return r.rows[0];
  }

  static async findById(conn, id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_bookings WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  }

  static async findByStripeSessionId(conn, sessionId) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_bookings
       WHERE stripe_checkout_session_id = $1 LIMIT 1`,
      [sessionId]
    );
    return r.rows[0] || null;
  }

  static async confirmBySessionId(conn, sessionId, paymentIntentId) {
    const r = await conn.query(
      `UPDATE public.tb_profile_bookings
         SET status = 'confirmed',
             payment_status = 'paid',
             stripe_payment_intent_id = $2,
             confirmed_at = NOW(),
             updated_at = NOW()
       WHERE stripe_checkout_session_id = $1
         AND status = 'pending_payment'
       RETURNING *`,
      [sessionId, paymentIntentId]
    );
    return r.rows[0] || null;
  }

  static async updateStatus(conn, id, status, extraFields = {}) {
    const sets = [`status = $2`, `updated_at = NOW()`];
    const vals = [id, status];
    let idx = 3;

    if (status === 'canceled') {
      sets.push(`canceled_at = NOW()`);
    }
    for (const [key, val] of Object.entries(extraFields)) {
      sets.push(`${key} = $${idx++}`);
      vals.push(val);
    }

    const r = await conn.query(
      `UPDATE public.tb_profile_bookings SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      vals
    );
    return r.rows[0] || null;
  }

  /**
   * Busca bookings ativos (não cancelados/expirados) para uma data em um perfil.
   * Usado para calcular slots indisponíveis.
   */
  static async getActiveBookingsForDate(conn, id_profile, booking_date) {
    const r = await conn.query(
      `SELECT start_time, end_time, status, payment_status
       FROM public.tb_profile_bookings
       WHERE id_profile = $1
         AND booking_date = $2
         AND status NOT IN ('canceled','expired')
       ORDER BY start_time`,
      [id_profile, booking_date]
    );
    return r.rows;
  }

  /**
   * Lista bookings de todos os perfis de um usuário (para dashboard do dono).
   */
  static async listByOwner(conn, owner_user_id, { limit = 50, offset = 0 } = {}) {
    const r = await conn.query(
      `SELECT b.*, p.display_name AS profile_name
       FROM public.tb_profile_bookings b
       JOIN public.tb_profile p ON p.id_profile = b.id_profile
       WHERE b.profile_owner_user_id = $1
       ORDER BY b.booking_date DESC, b.start_time DESC
       LIMIT $2 OFFSET $3`,
      [owner_user_id, limit, offset]
    );
    return r.rows;
  }

  /**
   * Lista bookings de um perfil específico.
   */
  static async listByProfile(conn, id_profile, { limit = 50, offset = 0 } = {}) {
    const r = await conn.query(
      `SELECT * FROM public.tb_profile_bookings
       WHERE id_profile = $1
       ORDER BY booking_date DESC, start_time DESC
       LIMIT $2 OFFSET $3`,
      [id_profile, limit, offset]
    );
    return r.rows;
  }

  /**
   * Tenta reservar um slot usando SELECT FOR UPDATE para evitar race condition.
   * Retorna true se o slot está livre, false se já ocupado.
   */
  static async lockAndCheckSlot(conn, id_profile, booking_date, start_time) {
    const r = await conn.query(
      `SELECT id FROM public.tb_profile_bookings
       WHERE id_profile = $1
         AND booking_date = $2
         AND start_time = $3
         AND status NOT IN ('canceled','expired')
       FOR UPDATE`,
      [id_profile, booking_date, start_time]
    );
    return r.rowCount === 0; // true = slot livre
  }

  /**
   * Expira bookings pending_payment criados há mais de X minutos.
   */
  static async expireStaleBookings(conn, minutes = 15) {
    const r = await conn.query(
      `UPDATE public.tb_profile_bookings
         SET status = 'expired',
             payment_status = 'canceled',
             updated_at = NOW()
       WHERE status = 'pending_payment'
         AND created_at < NOW() - INTERVAL '1 minute' * $1
       RETURNING id`,
      [minutes]
    );
    return r.rows;
  }
}

module.exports = BookingStorage;
