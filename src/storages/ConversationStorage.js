const PROFILE_TYPE = "profile";

function canonicalKey(idA, idB) {
  if (!idA || !idB) return null;
  const a = String(idA);
  const b = String(idB);
  if (a === b) return null;
  const [low, high] = a < b ? [a, b] : [b, a];
  return `${PROFILE_TYPE}:${low}|${PROFILE_TYPE}:${high}`;
}

function canonicalPair(idA, idB) {
  if (!idA || !idB) return null;
  const a = String(idA);
  const b = String(idB);
  if (a === b) return null;
  return a < b ? { entity_a_id: a, entity_b_id: b } : { entity_a_id: b, entity_b_id: a };
}

function encodeCursor(row) {
  const ts = row?.last_message_at || row?.created_at;
  const id = row?.id_conversation;
  if (!ts || !id) return null;
  const payload = JSON.stringify({
    ts: new Date(ts).toISOString(),
    id,
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(String(cursor), "base64url").toString("utf8")
    );
    if (!payload?.ts || !payload?.id) return null;
    return payload;
  } catch {
    return null;
  }
}

function listLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n)) return 20;
  return Math.min(Math.max(Math.floor(n), 1), 50);
}

class ConversationStorage {
  static canonicalKey(idA, idB) {
    return canonicalKey(idA, idB);
  }

  static canonicalPair(idA, idB) {
    return canonicalPair(idA, idB);
  }

  static decodeCursor(value) {
    return decodeCursor(value);
  }

  static encodeCursor(row) {
    return encodeCursor(row);
  }

  static listLimit(value) {
    return listLimit(value);
  }

  static async getById(conn, id_conversation) {
    if (!id_conversation) return null;
    const { rows } = await conn.query(
      `
      SELECT *
        FROM public.tb_conversation
       WHERE id_conversation = $1
         AND deleted_at IS NULL
       LIMIT 1
      `,
      [id_conversation]
    );
    return rows[0] || null;
  }

  static async findActiveByPair(conn, idA, idB) {
    const key = canonicalKey(idA, idB);
    if (!key) return null;
    const { rows } = await conn.query(
      `
      SELECT *
        FROM public.tb_conversation
       WHERE conversation_key = $1
         AND deleted_at IS NULL
       LIMIT 1
      `,
      [key]
    );
    return rows[0] || null;
  }

  static async getOrCreate(conn, idA, idB) {
    const pair = canonicalPair(idA, idB);
    const key = canonicalKey(idA, idB);
    if (!pair || !key) return null;

    const existing = await this.findActiveByPair(conn, idA, idB);
    if (existing) return { conversation: existing, created: false };

    const { rows: convRows } = await conn.query(
      `
      INSERT INTO public.tb_conversation (
        conversation_key,
        entity_a_type, entity_a_id,
        entity_b_type, entity_b_id
      )
      VALUES ($1, 'profile', $2, 'profile', $3)
      RETURNING *
      `,
      [key, pair.entity_a_id, pair.entity_b_id]
    );
    const conversation = convRows[0];

    await conn.query(
      `
      INSERT INTO public.tb_conversation_participant (
        id_conversation, entity_type, entity_id
      ) VALUES
        ($1, 'profile', $2),
        ($1, 'profile', $3)
      `,
      [conversation.id_conversation, pair.entity_a_id, pair.entity_b_id]
    );

    return { conversation, created: true };
  }

  static async getParticipant(conn, { id_conversation, entity_id }) {
    const { rows } = await conn.query(
      `
      SELECT *
        FROM public.tb_conversation_participant
       WHERE id_conversation = $1
         AND entity_id = $2
         AND deleted_at IS NULL
       LIMIT 1
      `,
      [id_conversation, entity_id]
    );
    return rows[0] || null;
  }

  static async listParticipants(conn, id_conversation) {
    const { rows } = await conn.query(
      `
      SELECT *
        FROM public.tb_conversation_participant
       WHERE id_conversation = $1
         AND deleted_at IS NULL
      `,
      [id_conversation]
    );
    return rows;
  }

  static async otherEntityId(conv, my_entity_id) {
    if (!conv) return null;
    if (String(conv.entity_a_id) === String(my_entity_id)) return conv.entity_b_id;
    if (String(conv.entity_b_id) === String(my_entity_id)) return conv.entity_a_id;
    return null;
  }

  static async markRead(conn, { id_conversation, entity_id }) {
    const { rows } = await conn.query(
      `
      UPDATE public.tb_conversation_participant
         SET unread_count = 0,
             last_read_at = NOW(),
             updated_at = NOW()
       WHERE id_conversation = $1
         AND entity_id = $2
         AND deleted_at IS NULL
       RETURNING *
      `,
      [id_conversation, entity_id]
    );
    return rows[0] || null;
  }

  static async incrementUnreadForOther(conn, { id_conversation, sender_entity_id }) {
    const { rows } = await conn.query(
      `
      UPDATE public.tb_conversation_participant
         SET unread_count = unread_count + 1,
             updated_at = NOW()
       WHERE id_conversation = $1
         AND entity_id <> $2
         AND deleted_at IS NULL
       RETURNING *
      `,
      [id_conversation, sender_entity_id]
    );
    return rows;
  }

  static async updateLastMessage(conn, {
    id_conversation,
    sender_entity_id,
    body,
    at,
  }) {
    const preview = String(body || "").slice(0, 200);
    const { rows } = await conn.query(
      `
      UPDATE public.tb_conversation
         SET last_message_at = $2,
             last_message_preview = $3,
             last_message_sender_entity_type = 'profile',
             last_message_sender_entity_id = $4,
             updated_at = NOW()
       WHERE id_conversation = $1
       RETURNING *
      `,
      [id_conversation, at || new Date(), preview, sender_entity_id]
    );
    return rows[0] || null;
  }

  static async listByEntity(conn, { entity_id, cursor, limit }) {
    const decoded = decodeCursor(cursor);
    const capped = listLimit(limit);
    const params = [entity_id, capped + 1];
    let cursorClause = "";
    if (decoded) {
      params.push(decoded.ts, decoded.id);
      cursorClause = `
        AND (
          c.last_message_at IS NOT NULL
          AND (
            c.last_message_at < $3::timestamptz
            OR (c.last_message_at = $3::timestamptz AND c.id_conversation < $4::uuid)
          )
        )
      `;
    }

    const { rows } = await conn.query(
      `
      SELECT
        c.*,
        cp.unread_count,
        cp.last_read_at,
        CASE
          WHEN c.entity_a_id = $1 THEN c.entity_b_id
          ELSE c.entity_a_id
        END AS other_entity_id
      FROM public.tb_conversation c
      JOIN public.tb_conversation_participant cp
        ON cp.id_conversation = c.id_conversation
       AND cp.entity_id = $1
       AND cp.deleted_at IS NULL
      WHERE c.deleted_at IS NULL
        AND (c.entity_a_id = $1 OR c.entity_b_id = $1)
        ${cursorClause}
      ORDER BY c.last_message_at DESC NULLS LAST, c.id_conversation DESC
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

  static async unreadTotalForEntity(conn, entity_id) {
    const { rows } = await conn.query(
      `
      SELECT COALESCE(SUM(unread_count), 0)::int AS total
        FROM public.tb_conversation_participant
       WHERE entity_id = $1
         AND deleted_at IS NULL
      `,
      [entity_id]
    );
    return rows[0]?.total || 0;
  }

  static async unreadTotalForUser(conn, id_user) {
    // Soma unread de TODAS as entidades que o usuário pode atuar:
    // 1) Subperfis dele (tb_profile.id_user = id_user)
    // 2) Clans onde ele é owner (via tb_clan_member com role='owner')
    const { rows } = await conn.query(
      `
      WITH actor_entities AS (
        SELECT p.id_profile AS entity_id
          FROM public.tb_profile p
         WHERE p.id_user = $1
           AND p.deleted_at IS NULL
        UNION
        SELECT cm.id_clan_profile AS entity_id
          FROM public.tb_clan_member cm
          JOIN public.tb_profile member_profile
            ON member_profile.id_profile = cm.id_member_profile
           AND member_profile.id_user = $1
         WHERE cm.role = 'owner'
      )
      SELECT COALESCE(SUM(cp.unread_count), 0)::int AS total
        FROM public.tb_conversation_participant cp
        JOIN actor_entities ae ON ae.entity_id = cp.entity_id
       WHERE cp.deleted_at IS NULL
      `,
      [id_user]
    );
    return rows[0]?.total || 0;
  }

  static async unreadByActor(conn, id_user) {
    // Retorna unread agregado por entidade-ator do usuário (para o seletor)
    const { rows } = await conn.query(
      `
      WITH actor_entities AS (
        SELECT p.id_profile AS entity_id
          FROM public.tb_profile p
         WHERE p.id_user = $1
           AND p.deleted_at IS NULL
        UNION
        SELECT cm.id_clan_profile AS entity_id
          FROM public.tb_clan_member cm
          JOIN public.tb_profile member_profile
            ON member_profile.id_profile = cm.id_member_profile
           AND member_profile.id_user = $1
         WHERE cm.role = 'owner'
      )
      SELECT ae.entity_id,
             COALESCE(SUM(cp.unread_count), 0)::int AS unread_count
        FROM actor_entities ae
        LEFT JOIN public.tb_conversation_participant cp
          ON cp.entity_id = ae.entity_id
         AND cp.deleted_at IS NULL
       GROUP BY ae.entity_id
      `,
      [id_user]
    );
    return rows;
  }

  static async softDelete(conn, id_conversation) {
    const { rows } = await conn.query(
      `
      UPDATE public.tb_conversation
         SET deleted_at = NOW(),
             updated_at = NOW()
       WHERE id_conversation = $1
         AND deleted_at IS NULL
       RETURNING *
      `,
      [id_conversation]
    );
    return rows[0] || null;
  }
}

module.exports = ConversationStorage;
