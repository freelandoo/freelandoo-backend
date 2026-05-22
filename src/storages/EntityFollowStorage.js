const ENTITY_TYPES = ["profile", "clan"];

function normalizeType(value) {
  const type = String(value || "").trim().toLowerCase();
  return ENTITY_TYPES.includes(type) ? type : null;
}

function encodeCursor(row) {
  if (!row?.created_at || !row?.follow_id) return null;
  const payload = JSON.stringify({
    created_at: new Date(row.created_at).toISOString(),
    id: row.follow_id,
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
  if (!Number.isFinite(n)) return 20;
  return Math.min(Math.max(Math.floor(n), 1), 50);
}

function entitySelect(alias = "p") {
  return `
    ${alias}.id_profile AS id,
    CASE WHEN ${alias}.is_clan THEN 'clan' ELSE 'profile' END AS type,
    ${alias}.id_user,
    ${alias}.display_name,
    ${alias}.bio,
    ${alias}.avatar_url,
    ${alias}.estado,
    ${alias}.municipio,
    ${alias}.sub_profile_slug,
    ${alias}.is_active,
    ${alias}.is_visible,
    ${alias}.deleted_at,
    ${alias}.is_clan,
    u.username,
    c.desc_category AS profession_name,
    c.profession_slug,
    m.name AS machine_name,
    m.slug AS machine_slug,
    CASE
      WHEN ${alias}.is_clan = FALSE THEN EXISTS (
        SELECT 1
          FROM public.tb_profile_subscription ps
         WHERE ps.id_profile = ${alias}.id_profile
           AND ps.status = 'active'
      )
      ELSE EXISTS (
        SELECT 1
          FROM public.tb_clan_member cm_owner
          JOIN public.tb_profile_subscription ps_owner
            ON ps_owner.id_profile = cm_owner.id_member_profile
           AND ps_owner.status = 'active'
         WHERE cm_owner.id_clan_profile = ${alias}.id_profile
           AND cm_owner.role = 'owner'
      )
    END AS is_paid,
    CASE
      WHEN ${alias}.is_clan THEN (
        SELECT COUNT(*)::int
          FROM public.tb_clan_member cm_count
         WHERE cm_count.id_clan_profile = ${alias}.id_profile
      )
      ELSE NULL::int
    END AS members_count
  `;
}

function entityJoins(alias = "p") {
  return `
    JOIN public.tb_user u ON u.id_user = ${alias}.id_user
    LEFT JOIN public.tb_category c ON c.id_category = ${alias}.id_category
    LEFT JOIN public.tb_machine m ON m.id_machine = COALESCE(c.id_machine, ${alias}.id_machine)
  `;
}

function publicEntityWhere(alias = "p") {
  return `
    ${alias}.deleted_at IS NULL
    AND ${alias}.is_active = TRUE
    AND ${alias}.is_visible = TRUE
    AND (
      (${alias}.is_clan = FALSE AND EXISTS (
        SELECT 1
          FROM public.tb_profile_subscription ps_public
         WHERE ps_public.id_profile = ${alias}.id_profile
           AND ps_public.status = 'active'
      ))
      OR
      (${alias}.is_clan = TRUE AND EXISTS (
        SELECT 1
          FROM public.tb_clan_member cm_public
          JOIN public.tb_profile_subscription ps_public_owner
            ON ps_public_owner.id_profile = cm_public.id_member_profile
           AND ps_public_owner.status = 'active'
         WHERE cm_public.id_clan_profile = ${alias}.id_profile
           AND cm_public.role = 'owner'
      ))
    )
  `;
}

class EntityFollowStorage {
  static normalizeType(value) {
    return normalizeType(value);
  }

  static decodeCursor(value) {
    return decodeCursor(value);
  }

  static listLimit(value) {
    return listLimit(value);
  }

  static async getEntity(conn, { type, id }) {
    const normalized = normalizeType(type);
    if (!normalized || !id) return null;
    const { rows } = await conn.query(
      `
      SELECT ${entitySelect("p")}
      FROM public.tb_profile p
      ${entityJoins("p")}
      WHERE p.id_profile = $1
        AND p.is_clan = $2
      LIMIT 1
      `,
      [id, normalized === "clan"]
    );
    return rows[0] || null;
  }

  static async getProfileActor(conn, { id_user, id_profile }) {
    const { rows } = await conn.query(
      `
      SELECT ${entitySelect("p")}
      FROM public.tb_profile p
      ${entityJoins("p")}
      WHERE p.id_profile = $1
        AND p.id_user = $2
        AND p.is_clan = FALSE
      LIMIT 1
      `,
      [id_profile, id_user]
    );
    return rows[0] || null;
  }

  static async getClanActor(conn, { id_user, id_profile }) {
    const { rows } = await conn.query(
      `
      SELECT ${entitySelect("p")}, cm.role AS my_role
      FROM public.tb_profile p
      JOIN public.tb_clan_member cm
        ON cm.id_clan_profile = p.id_profile
       AND cm.role = 'owner'
      JOIN public.tb_profile member_profile
        ON member_profile.id_profile = cm.id_member_profile
       AND member_profile.id_user = $2
      ${entityJoins("p")}
      WHERE p.id_profile = $1
        AND p.is_clan = TRUE
      LIMIT 1
      `,
      [id_profile, id_user]
    );
    return rows[0] || null;
  }

  static async listActorOptions(conn, id_user) {
    const { rows } = await conn.query(
      `
      WITH profile_actors AS (
        SELECT ${entitySelect("p")}, NULL::text AS my_role
          FROM public.tb_profile p
          ${entityJoins("p")}
         WHERE p.id_user = $1
           AND p.is_clan = FALSE
           AND ${publicEntityWhere("p")}
      ),
      clan_actors AS (
        SELECT ${entitySelect("p")}, cm.role AS my_role
          FROM public.tb_profile p
          JOIN public.tb_clan_member cm
            ON cm.id_clan_profile = p.id_profile
           AND cm.role = 'owner'
          JOIN public.tb_profile member_profile
            ON member_profile.id_profile = cm.id_member_profile
           AND member_profile.id_user = $1
          ${entityJoins("p")}
         WHERE p.is_clan = TRUE
           AND ${publicEntityWhere("p")}
      )
      SELECT * FROM profile_actors
      UNION ALL
      SELECT * FROM clan_actors
      ORDER BY type ASC, display_name ASC NULLS LAST
      `,
      [id_user]
    );
    return rows;
  }

  static isPublicEntity(entity) {
    return !!(
      entity &&
      entity.is_active &&
      entity.is_visible &&
      !entity.deleted_at &&
      entity.is_paid
    );
  }

  // Check mais frouxo usado pelo sistema de mensagens. Qualquer entidade ativa
  // e não apagada pode enviar/receber DM — inclusive perfil-fantasma do user
  // account (is_paid=FALSE, is_visible=FALSE), subperfis ainda não ativados e
  // clans. A ideia: mensagens privadas não dependem de assinatura.
  static isMessageableEntity(entity) {
    return !!(
      entity &&
      entity.is_active &&
      !entity.deleted_at
    );
  }

  static async findActive(conn, data) {
    const { rows } = await conn.query(
      `
      SELECT *
        FROM public.entity_follows
       WHERE follower_type = $1
         AND follower_id = $2
         AND target_type = $3
         AND target_id = $4
         AND deleted_at IS NULL
       LIMIT 1
      `,
      [data.follower_type, data.follower_id, data.target_type, data.target_id]
    );
    return rows[0] || null;
  }

  static async upsertActive(conn, data) {
    const { rows } = await conn.query(
      `
      WITH reactivated AS (
        UPDATE public.entity_follows
           SET deleted_at = NULL,
               updated_at = NOW()
         WHERE follower_type = $1
           AND follower_id = $2
           AND target_type = $3
           AND target_id = $4
           AND deleted_at IS NOT NULL
         RETURNING *
      ),
      inserted AS (
        INSERT INTO public.entity_follows (
          follower_type, follower_id, target_type, target_id
        )
        SELECT $1, $2, $3, $4
        WHERE NOT EXISTS (SELECT 1 FROM reactivated)
        ON CONFLICT (follower_type, follower_id, target_type, target_id)
          WHERE deleted_at IS NULL
        DO UPDATE SET updated_at = public.entity_follows.updated_at
        RETURNING *
      )
      SELECT *, TRUE AS changed FROM reactivated
      UNION ALL
      SELECT *, TRUE AS changed FROM inserted
      LIMIT 1
      `,
      [data.follower_type, data.follower_id, data.target_type, data.target_id]
    );
    return rows[0] || null;
  }

  static async softDelete(conn, data) {
    const { rows } = await conn.query(
      `
      UPDATE public.entity_follows
         SET deleted_at = NOW(),
             updated_at = NOW()
       WHERE follower_type = $1
         AND follower_id = $2
         AND target_type = $3
         AND target_id = $4
         AND deleted_at IS NULL
       RETURNING *
      `,
      [data.follower_type, data.follower_id, data.target_type, data.target_id]
    );
    return rows[0] || null;
  }

  static async counts(conn, { entity_type, entity_id }) {
    const { rows } = await conn.query(
      `
      SELECT
        (
          SELECT COUNT(*)::int
            FROM public.entity_follows ef
           WHERE ef.target_type = $1
             AND ef.target_id = $2
             AND ef.deleted_at IS NULL
        ) AS followers_count,
        (
          SELECT COUNT(*)::int
            FROM public.entity_follows ef
           WHERE ef.follower_type = $1
             AND ef.follower_id = $2
             AND ef.deleted_at IS NULL
        ) AS following_count
      `,
      [entity_type, entity_id]
    );
    return rows[0] || { followers_count: 0, following_count: 0 };
  }

  static async listFollowers(conn, { entity_type, entity_id, cursor, limit }) {
    const decoded = decodeCursor(cursor);
    const capped = listLimit(limit);
    const params = [entity_type, entity_id, capped + 1];
    let cursorClause = "";
    if (decoded) {
      params.push(decoded.created_at, decoded.id);
      cursorClause = `
        AND (ef.created_at, ef.id) < ($4::timestamptz, $5::uuid)
      `;
    }

    const { rows } = await conn.query(
      `
      SELECT
        ef.id AS follow_id,
        ef.created_at AS followed_at,
        ${entitySelect("p")}
      FROM public.entity_follows ef
      JOIN public.tb_profile p ON p.id_profile = ef.follower_id
      ${entityJoins("p")}
      WHERE ef.target_type = $1
        AND ef.target_id = $2
        AND ef.deleted_at IS NULL
        AND p.is_clan = (ef.follower_type = 'clan')
        AND ${publicEntityWhere("p")}
        ${cursorClause}
      ORDER BY ef.created_at DESC, ef.id DESC
      LIMIT $3
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

  static async listFollowing(conn, { entity_type, entity_id, cursor, limit }) {
    const decoded = decodeCursor(cursor);
    const capped = listLimit(limit);
    const params = [entity_type, entity_id, capped + 1];
    let cursorClause = "";
    if (decoded) {
      params.push(decoded.created_at, decoded.id);
      cursorClause = `
        AND (ef.created_at, ef.id) < ($4::timestamptz, $5::uuid)
      `;
    }

    const { rows } = await conn.query(
      `
      SELECT
        ef.id AS follow_id,
        ef.created_at AS followed_at,
        ${entitySelect("p")}
      FROM public.entity_follows ef
      JOIN public.tb_profile p ON p.id_profile = ef.target_id
      ${entityJoins("p")}
      WHERE ef.follower_type = $1
        AND ef.follower_id = $2
        AND ef.deleted_at IS NULL
        AND p.is_clan = (ef.target_type = 'clan')
        AND ${publicEntityWhere("p")}
        ${cursorClause}
      ORDER BY ef.created_at DESC, ef.id DESC
      LIMIT $3
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
}

module.exports = EntityFollowStorage;
