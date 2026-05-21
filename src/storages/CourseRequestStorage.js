/**
 * Storage para tb_course_request — pedidos de curso (broadcast por enxame+profissão).
 * Espelha ServiceRequestStorage mas sem cidade. Matching exige que o subperfil
 * tenha ao menos um curso publicado.
 */
class CourseRequestStorage {
  // ---------- Requests ----------
  static async createRequest(conn, { id_user, id_machine, id_category, description }) {
    const r = await conn.query(
      `INSERT INTO public.tb_course_request
         (id_buyer_user, id_machine, id_category, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id_user, id_machine, id_category, description]
    );
    return r.rows[0];
  }

  static async getRequestById(conn, id_request) {
    const r = await conn.query(
      `SELECT * FROM public.tb_course_request WHERE id_course_request = $1 LIMIT 1`,
      [id_request]
    );
    return r.rows[0] || null;
  }

  static async listRequestsByUser(conn, id_user) {
    const r = await conn.query(
      `SELECT r.*, m.name AS machine_name, c.desc_category AS category_name
         FROM public.tb_course_request r
         JOIN public.tb_machine m ON m.id_machine = r.id_machine
         JOIN public.tb_category c ON c.id_category = r.id_category
        WHERE r.id_buyer_user = $1
          AND r.user_hidden_at IS NULL
        ORDER BY r.created_at DESC`,
      [id_user]
    );
    return r.rows;
  }

  static async hideRequestForUser(conn, { id_request, id_user }) {
    const r = await conn.query(
      `UPDATE public.tb_course_request
          SET user_hidden_at = NOW()
        WHERE id_course_request = $1
          AND id_buyer_user = $2
          AND user_hidden_at IS NULL
        RETURNING id_course_request`,
      [id_request, id_user]
    );
    return r.rows[0] || null;
  }

  static async cancelRequest(conn, id_request) {
    const r = await conn.query(
      `UPDATE public.tb_course_request
          SET status = 'CANCELED', canceled_at = NOW()
        WHERE id_course_request = $1 AND status = 'OPEN'
        RETURNING *`,
      [id_request]
    );
    return r.rows[0] || null;
  }

  // ---------- Responses ----------
  static async upsertResponseAccept(conn, { id_request, id_profile, id_course }) {
    const r = await conn.query(
      `INSERT INTO public.tb_course_request_response
         (id_course_request, id_profile, id_course, status, pro_accepted_at)
       VALUES ($1, $2, $3, 'PRO_ACCEPTED', NOW())
       ON CONFLICT (id_course_request, id_profile) DO UPDATE
         SET status = 'PRO_ACCEPTED',
             pro_accepted_at = NOW(),
             id_course = COALESCE(EXCLUDED.id_course, public.tb_course_request_response.id_course)
       RETURNING *`,
      [id_request, id_profile, id_course || null]
    );
    return r.rows[0];
  }

  static async upsertResponseReject(conn, { id_request, id_profile }) {
    const r = await conn.query(
      `INSERT INTO public.tb_course_request_response
         (id_course_request, id_profile, status, pro_rejected_at)
       VALUES ($1, $2, 'PRO_REJECTED', NOW())
       ON CONFLICT (id_course_request, id_profile) DO UPDATE
         SET status = 'PRO_REJECTED', pro_rejected_at = NOW()
       RETURNING *`,
      [id_request, id_profile]
    );
    return r.rows[0];
  }

  static async getResponseByPair(conn, id_request, id_profile) {
    const r = await conn.query(
      `SELECT * FROM public.tb_course_request_response
        WHERE id_course_request = $1 AND id_profile = $2 LIMIT 1`,
      [id_request, id_profile]
    );
    return r.rows[0] || null;
  }

  static async getResponseById(conn, id_response) {
    const r = await conn.query(
      `SELECT * FROM public.tb_course_request_response WHERE id_response = $1 LIMIT 1`,
      [id_response]
    );
    return r.rows[0] || null;
  }

  static async listResponsesByRequest(conn, id_request) {
    const r = await conn.query(
      `SELECT resp.*,
              p.display_name, p.avatar_url, p.sub_profile_slug, p.is_clan,
              u.username
         FROM public.tb_course_request_response resp
         JOIN public.tb_profile p ON p.id_profile = resp.id_profile
         JOIN public.tb_user u ON u.id_user = p.id_user
        WHERE resp.id_course_request = $1
        ORDER BY resp.created_at DESC`,
      [id_request]
    );
    return r.rows;
  }

  // ---------- Mensagens ----------
  static async insertMessage(conn, { id_response, sender, content }) {
    const r = await conn.query(
      `INSERT INTO public.tb_course_request_message (id_response, sender, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id_response, sender, content]
    );
    return r.rows[0];
  }

  static async listMessages(conn, id_response) {
    const r = await conn.query(
      `SELECT * FROM public.tb_course_request_message
        WHERE id_response = $1
        ORDER BY created_at ASC`,
      [id_response]
    );
    return r.rows;
  }

  static async markReadByUser(conn, id_response) {
    await conn.query(
      `UPDATE public.tb_course_request_response SET user_last_read_at = NOW()
        WHERE id_response = $1`,
      [id_response]
    );
  }

  static async markReadByPro(conn, id_response) {
    await conn.query(
      `UPDATE public.tb_course_request_response SET pro_last_read_at = NOW()
        WHERE id_response = $1`,
      [id_response]
    );
  }

  // ---------- Chats list (user-side) ----------
  static async listChatsForUser(conn, id_user) {
    const r = await conn.query(
      `SELECT
         resp.id_response,
         resp.status AS response_status,
         resp.created_at AS response_created_at,
         resp.id_course,
         req.id_course_request AS id_request,
         req.status AS request_status,
         req.description AS request_description,
         req.id_machine,
         req.id_category,
         req.id_response_chosen,
         m.name AS machine_name,
         c.desc_category AS category_name,
         p.id_profile, p.display_name, p.avatar_url, p.sub_profile_slug, p.is_clan,
         u.username,
         (SELECT content FROM public.tb_course_request_message
            WHERE id_response = resp.id_response
            ORDER BY created_at DESC LIMIT 1) AS last_message,
         (SELECT created_at FROM public.tb_course_request_message
            WHERE id_response = resp.id_response
            ORDER BY created_at DESC LIMIT 1) AS last_message_at,
         (SELECT COUNT(*) FROM public.tb_course_request_message msg
            WHERE msg.id_response = resp.id_response
              AND msg.sender = 'PRO'
              AND (resp.user_last_read_at IS NULL OR msg.created_at > resp.user_last_read_at))::int AS unread_count
         FROM public.tb_course_request_response resp
         JOIN public.tb_course_request req ON req.id_course_request = resp.id_course_request
         JOIN public.tb_profile p ON p.id_profile = resp.id_profile
         JOIN public.tb_user u ON u.id_user = p.id_user
         JOIN public.tb_machine m ON m.id_machine = req.id_machine
         JOIN public.tb_category c ON c.id_category = req.id_category
        WHERE req.id_buyer_user = $1
          AND resp.status IN ('PRO_ACCEPTED','PRO_REJECTED','USER_REJECTED','FINALIZED','CLOSED_OTHER_WON')
        ORDER BY COALESCE(
          (SELECT created_at FROM public.tb_course_request_message
            WHERE id_response = resp.id_response
            ORDER BY created_at DESC LIMIT 1),
          resp.created_at
        ) DESC`,
      [id_user]
    );
    return r.rows;
  }

  // ---------- Mural (PRO-side) ----------
  // Lista pedidos abertos compatíveis com o subperfil. Exige curso publicado.
  static async listMuralForProfile(conn, profile) {
    const r = await conn.query(
      `SELECT
         r.*,
         u.username AS user_name,
         m.name AS machine_name,
         c.desc_category AS category_name,
         resp.id_response AS my_response_id,
         resp.status AS my_response_status,
         (SELECT COUNT(*)::int
            FROM public.tb_course_request_response resp_all
           WHERE resp_all.id_course_request = r.id_course_request
             AND resp_all.status IN ('PRO_ACCEPTED')
         ) AS responses_count
         FROM public.tb_course_request r
         JOIN public.tb_user u ON u.id_user = r.id_buyer_user
         JOIN public.tb_machine m ON m.id_machine = r.id_machine
         JOIN public.tb_category c ON c.id_category = r.id_category
         LEFT JOIN public.tb_course_request_response resp
           ON resp.id_course_request = r.id_course_request AND resp.id_profile = $1
        WHERE r.status = 'OPEN'
          AND r.id_machine = $2
          AND r.id_category = $3
          AND resp.id_response IS NULL
          AND EXISTS (
            SELECT 1 FROM public.courses cs
            WHERE cs.profile_id = $1 AND cs.status = 'published'
          )
        ORDER BY r.created_at DESC`,
      [profile.id_profile, profile.id_machine, profile.id_category]
    );
    return r.rows;
  }

  // ---------- Badges ----------
  static async getMuralLastSeen(conn, id_profile) {
    const r = await conn.query(
      `SELECT course_mural_last_seen_at FROM public.tb_profile WHERE id_profile = $1`,
      [id_profile]
    );
    return r.rows[0]?.course_mural_last_seen_at || null;
  }

  static async setMuralSeen(conn, id_profile) {
    await conn.query(
      `UPDATE public.tb_profile SET course_mural_last_seen_at = NOW() WHERE id_profile = $1`,
      [id_profile]
    );
  }

  static async countProUnreadChats(conn, id_profile) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_course_request_response resp
         JOIN public.tb_course_request_message msg
           ON msg.id_response = resp.id_response
        WHERE resp.id_profile = $1
          AND resp.status IN ('PRO_ACCEPTED')
          AND msg.sender = 'USER'
          AND (resp.pro_last_read_at IS NULL OR msg.created_at > resp.pro_last_read_at)`,
      [id_profile]
    );
    return r.rows[0].n;
  }

  static async countUserUnreadChats(conn, id_user) {
    const r = await conn.query(
      `SELECT COUNT(DISTINCT resp.id_response)::int AS n
         FROM public.tb_course_request r
         JOIN public.tb_course_request_response resp ON resp.id_course_request = r.id_course_request
         LEFT JOIN public.tb_course_request_message msg
           ON msg.id_response = resp.id_response
          AND msg.sender = 'PRO'
          AND (resp.user_last_read_at IS NULL OR msg.created_at > resp.user_last_read_at)
        WHERE r.id_buyer_user = $1
          AND resp.status IN ('PRO_ACCEPTED','FINALIZED')
          AND (
            (resp.status = 'PRO_ACCEPTED' AND resp.user_last_read_at IS NULL)
            OR msg.id_message IS NOT NULL
          )`,
      [id_user]
    );
    return r.rows[0].n;
  }

  static async countMuralNew(conn, profile, since) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_course_request r
         LEFT JOIN public.tb_course_request_response resp
           ON resp.id_course_request = r.id_course_request AND resp.id_profile = $1
        WHERE r.status = 'OPEN'
          AND r.id_machine = $2
          AND r.id_category = $3
          AND resp.id_response IS NULL
          AND ($4::timestamptz IS NULL OR r.created_at > $4)
          AND EXISTS (
            SELECT 1 FROM public.courses cs
            WHERE cs.profile_id = $1 AND cs.status = 'published'
          )`,
      [profile.id_profile, profile.id_machine, profile.id_category, since || null]
    );
    return r.rows[0].n;
  }
}

module.exports = CourseRequestStorage;
