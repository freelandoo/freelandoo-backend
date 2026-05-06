class ServiceRequestStorage {
  // ---------- Requests ----------
  static async createRequest(conn, { id_user, id_machine, id_category, estado, municipio, description }) {
    const r = await conn.query(
      `INSERT INTO public.tb_service_request
         (id_user, id_machine, id_category, estado, municipio, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id_user, id_machine, id_category, estado || null, municipio || null, description]
    );
    return r.rows[0];
  }

  static async getRequestById(conn, id_request) {
    const r = await conn.query(
      `SELECT * FROM public.tb_service_request WHERE id_request = $1 LIMIT 1`,
      [id_request]
    );
    return r.rows[0] || null;
  }

  static async listRequestsByUser(conn, id_user) {
    const r = await conn.query(
      `SELECT r.*, m.name AS machine_name, c.desc_category AS category_name
         FROM public.tb_service_request r
         JOIN public.tb_machine m ON m.id_machine = r.id_machine
         JOIN public.tb_category c ON c.id_category = r.id_category
        WHERE r.id_user = $1
        ORDER BY r.created_at DESC`,
      [id_user]
    );
    return r.rows;
  }

  static async cancelRequest(conn, id_request) {
    const r = await conn.query(
      `UPDATE public.tb_service_request
          SET status = 'CANCELED', canceled_at = NOW()
        WHERE id_request = $1 AND status = 'OPEN'
        RETURNING *`,
      [id_request]
    );
    return r.rows[0] || null;
  }

  static async fulfillRequest(conn, id_request, id_response_chosen) {
    const r = await conn.query(
      `UPDATE public.tb_service_request
          SET status = 'FULFILLED', fulfilled_at = NOW(), id_response_chosen = $2
        WHERE id_request = $1 AND status = 'OPEN'
        RETURNING *`,
      [id_request, id_response_chosen]
    );
    return r.rows[0] || null;
  }

  // ---------- Responses ----------
  static async getResponseById(conn, id_response) {
    const r = await conn.query(
      `SELECT * FROM public.tb_service_request_response WHERE id_response = $1 LIMIT 1`,
      [id_response]
    );
    return r.rows[0] || null;
  }

  static async getResponseByPair(conn, id_request, id_profile) {
    const r = await conn.query(
      `SELECT * FROM public.tb_service_request_response
        WHERE id_request = $1 AND id_profile = $2 LIMIT 1`,
      [id_request, id_profile]
    );
    return r.rows[0] || null;
  }

  static async upsertResponseAccept(conn, { id_request, id_profile }) {
    const r = await conn.query(
      `INSERT INTO public.tb_service_request_response
         (id_request, id_profile, status, pro_accepted_at)
       VALUES ($1, $2, 'PRO_ACCEPTED', NOW())
       ON CONFLICT (id_request, id_profile) DO UPDATE
         SET status = 'PRO_ACCEPTED', pro_accepted_at = NOW()
       RETURNING *`,
      [id_request, id_profile]
    );
    return r.rows[0];
  }

  static async upsertResponseReject(conn, { id_request, id_profile }) {
    const r = await conn.query(
      `INSERT INTO public.tb_service_request_response
         (id_request, id_profile, status, pro_rejected_at)
       VALUES ($1, $2, 'PRO_REJECTED', NOW())
       ON CONFLICT (id_request, id_profile) DO UPDATE
         SET status = 'PRO_REJECTED', pro_rejected_at = NOW()
       RETURNING *`,
      [id_request, id_profile]
    );
    return r.rows[0];
  }

  static async userRejectResponse(conn, id_response) {
    const r = await conn.query(
      `UPDATE public.tb_service_request_response
          SET status = 'USER_REJECTED', user_rejected_at = NOW()
        WHERE id_response = $1 AND status = 'PRO_ACCEPTED'
        RETURNING *`,
      [id_response]
    );
    return r.rows[0] || null;
  }

  static async finalizeResponse(conn, id_response) {
    const r = await conn.query(
      `UPDATE public.tb_service_request_response
          SET status = 'FINALIZED', finalized_at = NOW()
        WHERE id_response = $1 AND status = 'PRO_ACCEPTED'
        RETURNING *`,
      [id_response]
    );
    return r.rows[0] || null;
  }

  static async closeOtherResponses(conn, id_request, id_response_excluded) {
    const r = await conn.query(
      `UPDATE public.tb_service_request_response
          SET status = 'CLOSED_OTHER_WON'
        WHERE id_request = $1
          AND id_response <> $2
          AND status = 'PRO_ACCEPTED'
        RETURNING id_response`,
      [id_request, id_response_excluded]
    );
    return r.rowCount;
  }

  static async listResponsesByRequest(conn, id_request) {
    const r = await conn.query(
      `SELECT
         resp.*,
         p.display_name,
         p.avatar_url,
         p.sub_profile_slug,
         u.username,
         (SELECT content FROM public.tb_service_request_message
            WHERE id_response = resp.id_response
            ORDER BY created_at DESC LIMIT 1) AS last_message,
         (SELECT created_at FROM public.tb_service_request_message
            WHERE id_response = resp.id_response
            ORDER BY created_at DESC LIMIT 1) AS last_message_at,
         (SELECT COUNT(*) FROM public.tb_service_request_message msg
            WHERE msg.id_response = resp.id_response
              AND msg.sender = 'PRO'
              AND (resp.user_last_read_at IS NULL OR msg.created_at > resp.user_last_read_at)) AS user_unread
         FROM public.tb_service_request_response resp
         JOIN public.tb_profile p ON p.id_profile = resp.id_profile
         JOIN public.tb_user u ON u.id_user = p.id_user
        WHERE resp.id_request = $1
        ORDER BY resp.created_at ASC`,
      [id_request]
    );
    return r.rows;
  }

  // ---------- Mural ----------
  static async listMuralForProfile(conn, profile) {
    // profile: { id_profile, id_machine, id_category, municipio, is_clan }
    // Slice 2 trata apenas perfis não-clan; clans entram na Slice 4.
    const r = await conn.query(
      `SELECT
         r.*,
         u.username,
         u.username AS user_name,
         m.name AS machine_name,
         c.desc_category AS category_name,
         resp.id_response AS my_response_id,
         resp.status AS my_response_status
         FROM public.tb_service_request r
         JOIN public.tb_user u ON u.id_user = r.id_user
         JOIN public.tb_machine m ON m.id_machine = r.id_machine
         JOIN public.tb_category c ON c.id_category = r.id_category
         LEFT JOIN public.tb_service_request_response resp
           ON resp.id_request = r.id_request AND resp.id_profile = $1
        WHERE r.status = 'OPEN'
          AND r.id_machine = $2
          AND r.id_category = $3
          AND (r.municipio IS NULL OR r.municipio = $4)
          AND (resp.id_response IS NULL OR resp.status = 'PRO_ACCEPTED')
        ORDER BY r.created_at DESC`,
      [profile.id_profile, profile.id_machine, profile.id_category, profile.municipio || null]
    );
    return r.rows;
  }

  static async countMuralNew(conn, profile, since) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_service_request r
         LEFT JOIN public.tb_service_request_response resp
           ON resp.id_request = r.id_request AND resp.id_profile = $1
        WHERE r.status = 'OPEN'
          AND r.id_machine = $2
          AND r.id_category = $3
          AND (r.municipio IS NULL OR r.municipio = $4)
          AND resp.id_response IS NULL
          AND ($5::timestamptz IS NULL OR r.created_at > $5)`,
      [profile.id_profile, profile.id_machine, profile.id_category, profile.municipio || null, since || null]
    );
    return r.rows[0].n;
  }

  static async countProUnreadChats(conn, id_profile) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_service_request_response resp
         JOIN public.tb_service_request_message msg
           ON msg.id_response = resp.id_response
        WHERE resp.id_profile = $1
          AND resp.status = 'PRO_ACCEPTED'
          AND msg.sender = 'USER'
          AND (resp.pro_last_read_at IS NULL OR msg.created_at > resp.pro_last_read_at)`,
      [id_profile]
    );
    return r.rows[0].n;
  }

  static async countUserUnreadChats(conn, id_user) {
    // Conta responses que merecem destaque para o user:
    //  (a) aceitação nova ainda não vista (user_last_read_at IS NULL)
    //  (b) há mensagem do PRO posterior ao último user_last_read_at
    const r = await conn.query(
      `SELECT COUNT(DISTINCT resp.id_response)::int AS n
         FROM public.tb_service_request r
         JOIN public.tb_service_request_response resp ON resp.id_request = r.id_request
         LEFT JOIN public.tb_service_request_message msg
           ON msg.id_response = resp.id_response
          AND msg.sender = 'PRO'
          AND (resp.user_last_read_at IS NULL OR msg.created_at > resp.user_last_read_at)
        WHERE r.id_user = $1
          AND resp.status IN ('PRO_ACCEPTED','FINALIZED')
          AND (resp.user_last_read_at IS NULL OR msg.id_message IS NOT NULL)`,
      [id_user]
    );
    return r.rows[0].n;
  }

  static async getMuralLastSeen(conn, id_profile) {
    const r = await conn.query(
      `SELECT mural_last_seen_at FROM public.tb_profile WHERE id_profile = $1`,
      [id_profile]
    );
    return r.rows[0]?.mural_last_seen_at || null;
  }

  static async setMuralSeen(conn, id_profile) {
    await conn.query(
      `UPDATE public.tb_profile SET mural_last_seen_at = NOW() WHERE id_profile = $1`,
      [id_profile]
    );
  }

  // ---------- Messages ----------
  static async listMessages(conn, id_response) {
    const r = await conn.query(
      `SELECT id_message, id_response, sender, content, created_at
         FROM public.tb_service_request_message
        WHERE id_response = $1
        ORDER BY created_at ASC`,
      [id_response]
    );
    return r.rows;
  }

  static async createMessage(conn, { id_response, sender, content }) {
    const r = await conn.query(
      `INSERT INTO public.tb_service_request_message (id_response, sender, content)
       VALUES ($1, $2, $3)
       RETURNING id_message, id_response, sender, content, created_at`,
      [id_response, sender, content]
    );
    return r.rows[0];
  }

  static async markRead(conn, id_response, side) {
    const col = side === "USER" ? "user_last_read_at" : "pro_last_read_at";
    await conn.query(
      `UPDATE public.tb_service_request_response SET ${col} = NOW() WHERE id_response = $1`,
      [id_response]
    );
  }
}

module.exports = ServiceRequestStorage;
