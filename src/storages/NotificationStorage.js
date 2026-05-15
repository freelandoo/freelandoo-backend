class NotificationStorage {
  /**
   * Insere notificacao. Para tipos com unique parcial (like/follow), usa
   * ON CONFLICT DO NOTHING para deduplicar enquanto a notif anterior estiver
   * nao-lida. Retorna a linha inserida ou null se foi deduplicada.
   */
  static async insert(conn, data) {
    const { rows } = await conn.query(
      `
      INSERT INTO public.tb_notification (
        id_recipient_user, id_recipient_profile, type,
        id_actor_user, id_actor_profile,
        entity_type, entity_id, payload
      ) VALUES (
        $1, $2, $3,
        $4, $5,
        $6, $7, COALESCE($8, '{}'::jsonb)
      )
      ON CONFLICT DO NOTHING
      RETURNING *
      `,
      [
        data.id_recipient_user,
        data.id_recipient_profile || null,
        data.type,
        data.id_actor_user || null,
        data.id_actor_profile || null,
        data.entity_type || null,
        data.entity_id || null,
        data.payload ? JSON.stringify(data.payload) : null,
      ]
    );
    return rows[0] || null;
  }

  /**
   * Resolve o user dono do perfil. Subperfil: tb_profile.id_user direto.
   * Clan: id_user do member com role='owner'.
   */
  static async resolveProfileOwnerUserId(conn, id_profile) {
    const { rows } = await conn.query(
      `
      SELECT
        CASE
          WHEN p.is_clan = FALSE THEN p.id_user
          ELSE owner_p.id_user
        END AS id_user
      FROM public.tb_profile p
      LEFT JOIN public.tb_clan_member cm
        ON cm.id_clan_profile = p.id_profile
       AND cm.role = 'owner'
      LEFT JOIN public.tb_profile owner_p
        ON owner_p.id_profile = cm.id_member_profile
      WHERE p.id_profile = $1
      LIMIT 1
      `,
      [id_profile]
    );
    return rows[0]?.id_user || null;
  }

  static async listForUser(conn, { id_recipient_user, cursor, limit }) {
    const capped = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const params = [id_recipient_user, capped + 1];
    let cursorClause = "";
    if (cursor) {
      try {
        const decoded = JSON.parse(
          Buffer.from(String(cursor), "base64url").toString("utf8")
        );
        if (decoded?.created_at && decoded?.id) {
          params.push(decoded.created_at, decoded.id);
          cursorClause = `AND (n.created_at, n.id_notification) < ($3::timestamptz, $4::uuid)`;
        }
      } catch {
        // ignora cursor inválido
      }
    }

    const { rows } = await conn.query(
      `
      SELECT
        n.*,
        au.username        AS actor_username,
        ap.display_name    AS actor_profile_display_name,
        ap.avatar_url      AS actor_profile_avatar_url
      FROM public.tb_notification n
      LEFT JOIN public.tb_user    au ON au.id_user    = n.id_actor_user
      LEFT JOIN public.tb_profile ap ON ap.id_profile = n.id_actor_profile
      WHERE n.id_recipient_user = $1
        ${cursorClause}
      ORDER BY n.created_at DESC, n.id_notification DESC
      LIMIT $2
      `,
      params
    );

    const hasMore = rows.length > capped;
    const items = hasMore ? rows.slice(0, capped) : rows;
    const last = items[items.length - 1];
    const next_cursor =
      hasMore && last
        ? Buffer.from(
            JSON.stringify({
              created_at: new Date(last.created_at).toISOString(),
              id: last.id_notification,
            }),
            "utf8"
          ).toString("base64url")
        : null;

    return { items, next_cursor, has_more: hasMore };
  }

  static async countUnread(conn, id_recipient_user) {
    const { rows } = await conn.query(
      `
      SELECT COUNT(*)::int AS unread
        FROM public.tb_notification
       WHERE id_recipient_user = $1
         AND read_at IS NULL
      `,
      [id_recipient_user]
    );
    return rows[0]?.unread || 0;
  }

  static async markAllRead(conn, id_recipient_user) {
    const { rowCount } = await conn.query(
      `
      UPDATE public.tb_notification
         SET read_at = NOW()
       WHERE id_recipient_user = $1
         AND read_at IS NULL
      `,
      [id_recipient_user]
    );
    return rowCount || 0;
  }

  static async markOneRead(conn, { id_notification, id_recipient_user }) {
    const { rows } = await conn.query(
      `
      UPDATE public.tb_notification
         SET read_at = COALESCE(read_at, NOW())
       WHERE id_notification = $1
         AND id_recipient_user = $2
       RETURNING *
      `,
      [id_notification, id_recipient_user]
    );
    return rows[0] || null;
  }
}

module.exports = NotificationStorage;
