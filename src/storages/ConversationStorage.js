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
          WHEN c.kind = 'group' THEN NULL
          WHEN c.entity_a_id = $1 THEN c.entity_b_id
          ELSE c.entity_a_id
        END AS other_entity_id,
        CASE WHEN c.kind = 'group' THEN (
          SELECT COUNT(*)::int FROM public.tb_conversation_participant cp2
           WHERE cp2.id_conversation = c.id_conversation AND cp2.deleted_at IS NULL
        ) ELSE NULL END AS member_count
      FROM public.tb_conversation c
      JOIN public.tb_conversation_participant cp
        ON cp.id_conversation = c.id_conversation
       AND cp.entity_id = $1
       AND cp.deleted_at IS NULL
      WHERE c.deleted_at IS NULL
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

  /* ────────────────── Grupos (mig 078) ────────────────── */

  static async createGroup(conn, { owner_profile_id, name, cover_url, max_members }) {
    const cap = Math.min(Math.max(parseInt(max_members, 10) || 200, 2), 500);
    const key = `group:${owner_profile_id}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const { rows } = await conn.query(
      `
      INSERT INTO public.tb_conversation (
        conversation_key, kind, name, cover_url, owner_profile_id, max_members
      )
      VALUES ($1, 'group', $2, $3, $4, $5)
      RETURNING *
      `,
      [key, name.trim(), cover_url || null, owner_profile_id, cap]
    );
    return rows[0];
  }

  static async addGroupMember(conn, { id_conversation, profile_id, role = "member" }) {
    const { rows } = await conn.query(
      `
      INSERT INTO public.tb_conversation_participant (
        id_conversation, entity_type, entity_id, role
      )
      VALUES ($1, 'profile', $2, $3)
      ON CONFLICT DO NOTHING
      RETURNING *
      `,
      [id_conversation, profile_id, role]
    );
    return rows[0] || null;
  }

  static async countGroupMembers(conn, id_conversation) {
    const { rows } = await conn.query(
      `
      SELECT COUNT(*)::int AS c
        FROM public.tb_conversation_participant
       WHERE id_conversation = $1
         AND deleted_at IS NULL
      `,
      [id_conversation]
    );
    return rows[0]?.c || 0;
  }

  static async listGroupMembers(conn, id_conversation) {
    const { rows } = await conn.query(
      `
      SELECT
        cp.id_conversation_participant,
        cp.entity_id          AS id_profile,
        cp.role,
        cp.created_at         AS joined_at,
        p.display_name,
        p.avatar_url,
        p.sub_profile_slug,
        u.username
        FROM public.tb_conversation_participant cp
        JOIN public.tb_profile p ON p.id_profile = cp.entity_id
        LEFT JOIN public.tb_user u ON u.id_user = p.id_user
       WHERE cp.id_conversation = $1
         AND cp.deleted_at IS NULL
       ORDER BY
         CASE cp.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
         cp.created_at ASC
      `,
      [id_conversation]
    );
    return rows;
  }

  static async removeGroupMember(conn, { id_conversation, profile_id }) {
    const { rows } = await conn.query(
      `
      UPDATE public.tb_conversation_participant
         SET deleted_at = NOW(), updated_at = NOW()
       WHERE id_conversation = $1
         AND entity_id = $2
         AND deleted_at IS NULL
       RETURNING *
      `,
      [id_conversation, profile_id]
    );
    return rows[0] || null;
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
