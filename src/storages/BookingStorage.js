class BookingStorage {
  static async create(conn, {
    id_profile, profile_owner_user_id, id_client_user = null,
    client_name, client_email, client_whatsapp,
    booking_date, start_time, end_time,
    deposit_amount, platform_fee_amount, professional_amount,
    stripe_checkout_session_id,
    id_profile_service = null, service_name_snapshot = null, service_price_amount = null,
  }) {
    const r = await conn.query(
      `INSERT INTO public.tb_profile_bookings
        (id_profile, profile_owner_user_id, id_client_user,
         client_name, client_email, client_whatsapp,
         booking_date, start_time, end_time,
         deposit_amount, platform_fee_amount, professional_amount,
         stripe_checkout_session_id, status, payment_status,
         id_profile_service, service_name_snapshot, service_price_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending_payment','pending',$14,$15,$16)
       RETURNING *`,
      [id_profile, profile_owner_user_id, id_client_user,
       client_name, client_email, client_whatsapp,
       booking_date, start_time, end_time,
       deposit_amount, platform_fee_amount, professional_amount,
       stripe_checkout_session_id,
       id_profile_service, service_name_snapshot, service_price_amount]
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
  // Desde a mig 190 recebem o ESCOPO DA AGENDA (todos os perfis do dono), não
  // um perfil só — a agenda é da conta.
  static async getActiveBookingsForDate(conn, profileIds, booking_date) {
    const ids = Array.isArray(profileIds) ? profileIds : [profileIds];
    const r = await conn.query(
      `SELECT start_time, end_time, status, payment_status
       FROM public.tb_profile_bookings
       WHERE id_profile = ANY($1::uuid[])
         AND booking_date = $2
         AND status NOT IN ('canceled','expired')
       ORDER BY start_time`,
      [ids, booking_date]
    );
    return r.rows;
  }

  /**
   * Busca bookings ativos para um intervalo de datas (semana) no escopo da
   * agenda. Traz o perfil de origem pra tela mostrar "agendado pelo perfil X".
   */
  static async getActiveBookingsInRange(conn, profileIds, start_date, end_date) {
    const ids = Array.isArray(profileIds) ? profileIds : [profileIds];
    const r = await conn.query(
      `SELECT b.id, b.booking_date, b.start_time, b.end_time, b.status, b.payment_status,
              b.service_name_snapshot, b.client_name,
              b.id_profile,
              p.display_name AS origin_profile_name,
              COALESCE(p.is_user_account, FALSE) AS origin_is_user_account
       FROM public.tb_profile_bookings b
       LEFT JOIN public.tb_profile p ON p.id_profile = b.id_profile
       WHERE b.id_profile = ANY($1::uuid[])
         AND b.booking_date BETWEEN $2 AND $3
         AND b.status NOT IN ('canceled','expired')
       ORDER BY b.booking_date, b.start_time`,
      [ids, start_date, end_date]
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
   * Lista bookings do ESCOPO DA AGENDA (mig 190) — todos os perfis do dono.
   * Cada linha traz o perfil de ORIGEM, que é como a tela diz por qual perfil
   * o cliente agendou.
   */
  static async listByProfile(conn, profileIds, { limit = 50, offset = 0 } = {}) {
    const ids = Array.isArray(profileIds) ? profileIds : [profileIds];
    const r = await conn.query(
      `SELECT
         b.*,
         u.id_user                       AS client_user_id,
         cp.id_profile                   AS client_profile_id,
         cp.display_name                 AS client_profile_display_name,
         op.display_name                 AS origin_profile_name,
         COALESCE(op.is_user_account, FALSE) AS origin_is_user_account
       FROM public.tb_profile_bookings b
       LEFT JOIN public.tb_profile op ON op.id_profile = b.id_profile
       LEFT JOIN public.tb_user u
         ON LOWER(u.email) = LOWER(b.client_email)
       LEFT JOIN LATERAL (
         SELECT id_profile, display_name
         FROM public.tb_profile
         WHERE id_user = u.id_user
           AND deleted_at IS NULL
           AND is_active = TRUE
         ORDER BY created_at ASC
         LIMIT 1
       ) cp ON TRUE
       WHERE b.id_profile = ANY($1::uuid[])
       ORDER BY b.created_at DESC
       LIMIT $2 OFFSET $3`,
      [ids, limit, offset]
    );
    return r.rows;
  }

  /**
   * Tenta reservar um slot usando SELECT FOR UPDATE para evitar race condition.
   * Retorna true se o slot está livre, false se já ocupado.
   */
  // profileIds = escopo da agenda (mig 190). Checar só o perfil que recebeu o
  // agendamento deixava dois perfis do MESMO dono venderem a mesma hora.
  static async lockAndCheckSlot(conn, profileIds, booking_date, start_time, end_time) {
    const ids = Array.isArray(profileIds) ? profileIds : [profileIds];
    // Sem end_time: comportamento antigo (compat) — checa apenas start exato.
    if (!end_time) {
      const r = await conn.query(
        `SELECT id FROM public.tb_profile_bookings
         WHERE id_profile = ANY($1::uuid[])
           AND booking_date = $2
           AND start_time = $3
           AND status NOT IN ('canceled','expired')
         FOR UPDATE`,
        [ids, booking_date, start_time]
      );
      return r.rowCount === 0;
    }
    // Com end_time: detecta overlap [start_time, end_time) com qualquer booking ativo do dia.
    const r = await conn.query(
      `SELECT id FROM public.tb_profile_bookings
       WHERE id_profile = ANY($1::uuid[])
         AND booking_date = $2
         AND status NOT IN ('canceled','expired')
         AND start_time < $4
         AND end_time   > $3
       FOR UPDATE`,
      [ids, booking_date, start_time, end_time]
    );
    return r.rowCount === 0;
  }

  /**
   * Expira um booking pelo session_id quando a checkout session expira/falha
   * (libera o slot imediatamente, sem esperar o job de idade).
   */
  static async expireBySessionId(conn, sessionId) {
    const r = await conn.query(
      `UPDATE public.tb_profile_bookings
         SET status = 'expired',
             payment_status = 'canceled',
             updated_at = NOW()
       WHERE stripe_checkout_session_id = $1
         AND status = 'pending_payment'
       RETURNING id`,
      [sessionId]
    );
    return r.rows[0] || null;
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
