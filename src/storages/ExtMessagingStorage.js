// src/storages/ExtMessagingStorage.js
// Consultas de ESCOPO da API de Atendimento. Uma conversa está no alcance de
// uma conexão se: (O.S. do dono, sempre) OU (direta criada após a conexão) OU
// (scope_personal=TRUE → qualquer direta do dono). Grupos/clans/comunidades
// ficam fora em qualquer caso.

class ExtMessagingStorage {
  static async listDmInScope(conn, { id_user, scope_personal, connected_at, updated_since, limit }) {
    const { rows } = await conn.query(
      `
      SELECT * FROM (
        SELECT DISTINCT ON (c.id_conversation)
          c.id_conversation, c.created_at, c.last_message_at, c.last_message_preview,
          my.id_profile   AS my_profile_id,
          other.id_profile AS other_profile_id,
          other.display_name AS other_display_name,
          other.avatar_url   AS other_avatar_url,
          other.sub_profile_slug AS other_sub_profile_slug,
          ou.username        AS other_username
          FROM public.tb_conversation c
          JOIN public.tb_profile my
            ON my.id_profile IN (c.entity_a_id, c.entity_b_id)
           AND my.id_user = $1
           AND my.is_clan = FALSE
           AND COALESCE(my.is_community, FALSE) = FALSE
           AND my.deleted_at IS NULL
          JOIN public.tb_profile other
            ON other.id_profile = CASE WHEN c.entity_a_id = my.id_profile
                                       THEN c.entity_b_id ELSE c.entity_a_id END
          LEFT JOIN public.tb_user ou ON ou.id_user = other.id_user
         WHERE c.kind = 'direct'
           AND c.deleted_at IS NULL
           AND ($2::boolean OR c.created_at >= $3::timestamptz)
         ORDER BY c.id_conversation, my.created_at ASC
      ) scoped
      WHERE ($4::timestamptz IS NULL OR GREATEST(COALESCE(scoped.last_message_at, scoped.created_at), scoped.created_at) >= $4::timestamptz)
      ORDER BY COALESCE(scoped.last_message_at, scoped.created_at) DESC
      LIMIT $5
      `,
      [id_user, !!scope_personal, connected_at, updated_since || null, limit]
    );
    return rows;
  }

  static async getDmInScope(conn, { id_conversation, id_user, scope_personal, connected_at }) {
    const { rows } = await conn.query(
      `
      SELECT c.id_conversation, c.created_at, my.id_profile AS my_profile_id
        FROM public.tb_conversation c
        JOIN public.tb_profile my
          ON my.id_profile IN (c.entity_a_id, c.entity_b_id)
         AND my.id_user = $2
         AND my.is_clan = FALSE
         AND COALESCE(my.is_community, FALSE) = FALSE
         AND my.deleted_at IS NULL
       WHERE c.id_conversation = $1
         AND c.kind = 'direct'
         AND c.deleted_at IS NULL
         AND ($3::boolean OR c.created_at >= $4::timestamptz)
       ORDER BY my.created_at ASC
       LIMIT 1
      `,
      [id_conversation, id_user, !!scope_personal, connected_at]
    );
    return rows[0] || null;
  }

  static async listOsInScope(conn, { id_user, updated_since, limit }) {
    const { rows } = await conn.query(
      `
      SELECT resp.id_response, resp.id_request, resp.status, resp.created_at,
             req.description, req.estado, req.municipio,
             bu.username AS buyer_username,
             p.id_profile AS my_profile_id,
             p.display_name AS my_profile_name,
             lm.content    AS last_message_preview,
             lm.created_at AS last_message_at
        FROM public.tb_service_request_response resp
        JOIN public.tb_profile p
          ON p.id_profile = resp.id_profile AND p.id_user = $1 AND p.deleted_at IS NULL
        JOIN public.tb_service_request req ON req.id_request = resp.id_request
        JOIN public.tb_user bu ON bu.id_user = req.id_user
        LEFT JOIN LATERAL (
          SELECT content, created_at
            FROM public.tb_service_request_message
           WHERE id_response = resp.id_response
           ORDER BY created_at DESC LIMIT 1
        ) lm ON TRUE
       WHERE resp.status IN ('PENDING','PRO_ACCEPTED')
         AND ($2::timestamptz IS NULL OR COALESCE(lm.created_at, resp.created_at) >= $2::timestamptz)
       ORDER BY COALESCE(lm.created_at, resp.created_at) DESC
       LIMIT $3
      `,
      [id_user, updated_since || null, limit]
    );
    return rows;
  }

  static async getOsInScope(conn, { id_response, id_user }) {
    const { rows } = await conn.query(
      `
      SELECT resp.id_response, resp.status
        FROM public.tb_service_request_response resp
        JOIN public.tb_profile p
          ON p.id_profile = resp.id_profile AND p.id_user = $2 AND p.deleted_at IS NULL
       WHERE resp.id_response = $1
      `,
      [id_response, id_user]
    );
    return rows[0] || null;
  }

  static async getUserBasic(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT id_user, username, email FROM public.tb_user WHERE id_user = $1`,
      [id_user]
    );
    return rows[0] || null;
  }

  static async getProfileBrief(conn, id_profile) {
    const { rows } = await conn.query(
      `SELECT p.id_profile, p.display_name, p.sub_profile_slug, u.username
         FROM public.tb_profile p
         LEFT JOIN public.tb_user u ON u.id_user = p.id_user
        WHERE p.id_profile = $1`,
      [id_profile]
    );
    return rows[0] || null;
  }
}

module.exports = ExtMessagingStorage;
