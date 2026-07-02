function encodeCursor(row) {
  if (!row?.created_at || !row?.id_message) return null;
  const payload = JSON.stringify({
    created_at: new Date(row.created_at).toISOString(),
    id: row.id_message,
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(String(cursor), "base64url").toString("utf8")
    );
    if (!payload?.created_at || !payload?.id) return null;
    return payload;
  } catch {
    return null;
  }
}

function listLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n)) return 30;
  return Math.min(Math.max(Math.floor(n), 1), 100);
}

class MessageStorage {
  static decodeCursor(value) {
    return decodeCursor(value);
  }

  static encodeCursor(row) {
    return encodeCursor(row);
  }

  static listLimit(value) {
    return listLimit(value);
  }

  static async create(conn, { id_conversation, sender_entity_id, sender_user_id, body, sent_via = "app" }) {
    const { rows } = await conn.query(
      `
      INSERT INTO public.tb_message (
        id_conversation,
        sender_entity_type, sender_entity_id,
        sender_user_id,
        body,
        kind,
        sent_via
      )
      VALUES ($1, 'profile', $2, $3, $4, 'text', $5)
      RETURNING *
      `,
      [id_conversation, sender_entity_id, sender_user_id, body, sent_via]
    );
    return rows[0] || null;
  }

  /**
   * Pré-cria o row da mensagem de áudio com placeholder de URL/key, para
   * conseguirmos usar o id_message no path do R2 antes do upload.
   */
  static async createAudioPending(conn, { id_conversation, sender_entity_id, sender_user_id }) {
    const { rows } = await conn.query(
      `
      INSERT INTO public.tb_message (
        id_conversation,
        sender_entity_type, sender_entity_id,
        sender_user_id,
        kind,
        media_processing_status
      )
      VALUES ($1, 'profile', $2, $3, 'audio', 'processing')
      RETURNING *
      `,
      [id_conversation, sender_entity_id, sender_user_id]
    );
    return rows[0] || null;
  }

  static async finalizeAudio(conn, id_message, {
    audio_url,
    audio_storage_key,
    audio_duration_seconds,
    audio_size_bytes,
    audio_mime_type,
    audio_codec,
    audio_bitrate,
  }) {
    const { rows } = await conn.query(
      `
      UPDATE public.tb_message
         SET audio_url = $2,
             audio_storage_key = $3,
             audio_duration_seconds = $4,
             audio_size_bytes = $5,
             audio_mime_type = $6,
             audio_codec = $7,
             audio_bitrate = $8,
             media_processing_status = 'ready'
       WHERE id_message = $1
       RETURNING *
      `,
      [
        id_message,
        audio_url,
        audio_storage_key,
        audio_duration_seconds,
        audio_size_bytes,
        audio_mime_type,
        audio_codec,
        audio_bitrate,
      ]
    );
    return rows[0] || null;
  }

  static async markAudioFailed(conn, id_message) {
    await conn.query(
      `UPDATE public.tb_message
          SET media_processing_status = 'failed'
        WHERE id_message = $1`,
      [id_message]
    );
  }

  static async hardDeletePending(conn, id_message) {
    await conn.query(
      `DELETE FROM public.tb_message
        WHERE id_message = $1 AND media_processing_status = 'processing'`,
      [id_message]
    );
  }

  static async getById(conn, id_message) {
    const { rows } = await conn.query(
      `
      SELECT *
        FROM public.tb_message
       WHERE id_message = $1
         AND deleted_at IS NULL
       LIMIT 1
      `,
      [id_message]
    );
    return rows[0] || null;
  }

  static async listByConversation(conn, { id_conversation, cursor, limit }) {
    const decoded = decodeCursor(cursor);
    const capped = listLimit(limit);
    const params = [id_conversation, capped + 1];
    let cursorClause = "";
    if (decoded) {
      params.push(decoded.created_at, decoded.id);
      cursorClause = `
        AND (m.created_at, m.id_message) < ($3::timestamptz, $4::uuid)
      `;
    }

    const { rows } = await conn.query(
      `
      SELECT m.*
        FROM public.tb_message m
       WHERE m.id_conversation = $1
         AND m.deleted_at IS NULL
         AND m.media_processing_status <> 'processing'
         ${cursorClause}
       ORDER BY m.created_at DESC, m.id_message DESC
       LIMIT $2
      `,
      params
    );

    const hasMore = rows.length > capped;
    const items = hasMore ? rows.slice(0, capped) : rows;
    return {
      items,
      next_cursor: hasMore ? encodeCursor(items[items.length - 1]) : null,
      has_more: hasMore,
    };
  }

  static async countSentByUserSince(conn, { id_user, since }) {
    const { rows } = await conn.query(
      `
      SELECT COUNT(*)::int AS total
        FROM public.tb_message
       WHERE sender_user_id = $1
         AND created_at >= $2
         AND deleted_at IS NULL
      `,
      [id_user, since]
    );
    return rows[0]?.total || 0;
  }

  static async countAudioSentByUserSince(conn, { id_user, since }) {
    const { rows } = await conn.query(
      `
      SELECT COUNT(*)::int AS total
        FROM public.tb_message
       WHERE sender_user_id = $1
         AND created_at >= $2
         AND deleted_at IS NULL
         AND kind = 'audio'
      `,
      [id_user, since]
    );
    return rows[0]?.total || 0;
  }

  static async softDelete(conn, id_message) {
    const { rows } = await conn.query(
      `
      UPDATE public.tb_message
         SET deleted_at = NOW()
       WHERE id_message = $1
         AND deleted_at IS NULL
       RETURNING *
      `,
      [id_message]
    );
    return rows[0] || null;
  }
}

module.exports = MessageStorage;
