"use strict";

const ONLINE_WINDOW_SECONDS = 60;

class ChatStorage {
  // ----------------------------------------------------------------
  // Rooms
  // ----------------------------------------------------------------

  /**
   * Procura a primeira sala ativa do tipo/máquina que tenha vaga
   * (current_users < max_users). Retorna null se nenhuma tiver vaga.
   */
  static async findAvailableRoom(conn, { type, id_machine }) {
    const args = [type, ONLINE_WINDOW_SECONDS];
    let machineClause = "r.id_machine IS NULL";
    if (id_machine != null) {
      machineClause = "r.id_machine = $3";
      args.push(id_machine);
    }
    const { rows } = await conn.query(
      `
      SELECT r.*,
             COALESCE(p.online_count, 0)::int AS current_users
        FROM public.tb_chat_room r
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS online_count
            FROM public.tb_chat_presence pr
           WHERE pr.id_chat_room = r.id_chat_room
             AND pr.last_seen_at > NOW() - ($2 || ' seconds')::interval
        ) p ON TRUE
       WHERE r.type = $1
         AND r.status = 'active'
         AND ${machineClause}
         AND COALESCE(p.online_count, 0) < r.max_users
       ORDER BY r.instance_number ASC
       LIMIT 1
      `,
      args
    );
    return rows[0] || null;
  }

  static async getMaxInstanceNumber(conn, { type, id_machine }) {
    const args = [type];
    let machineClause = "id_machine IS NULL";
    if (id_machine != null) {
      machineClause = "id_machine = $2";
      args.push(id_machine);
    }
    const { rows } = await conn.query(
      `SELECT COALESCE(MAX(instance_number), 0)::int AS max_n
         FROM public.tb_chat_room
        WHERE type = $1 AND ${machineClause}`,
      args
    );
    return rows[0]?.max_n || 0;
  }

  static async createRoom(conn, { type, id_machine, instance_number, max_users, display_name, internal_name }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_chat_room
        (type, id_machine, instance_number, max_users, display_name, internal_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING *`,
      [type, id_machine || null, instance_number, max_users || 100, display_name, internal_name]
    );
    return rows[0];
  }

  static async getRoomById(conn, id_chat_room) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_chat_room WHERE id_chat_room = $1`,
      [id_chat_room]
    );
    return rows[0] || null;
  }

  static async countOnline(conn, id_chat_room) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_chat_presence
        WHERE id_chat_room = $1
          AND last_seen_at > NOW() - ($2 || ' seconds')::interval`,
      [id_chat_room, ONLINE_WINDOW_SECONDS]
    );
    return rows[0]?.n || 0;
  }

  // ----------------------------------------------------------------
  // Presença
  // ----------------------------------------------------------------

  static async upsertPresence(conn, { id_chat_room, id_user }) {
    await conn.query(
      `INSERT INTO public.tb_chat_presence (id_chat_room, id_user)
       VALUES ($1, $2)
       ON CONFLICT (id_chat_room, id_user)
       DO UPDATE SET last_seen_at = NOW()`,
      [id_chat_room, id_user]
    );
  }

  static async removePresence(conn, { id_chat_room, id_user }) {
    await conn.query(
      `DELETE FROM public.tb_chat_presence
        WHERE id_chat_room = $1 AND id_user = $2`,
      [id_chat_room, id_user]
    );
  }

  // ----------------------------------------------------------------
  // Mensagens
  // ----------------------------------------------------------------

  /**
   * Retorna número de mensagens enviadas pelo user nos últimos X segundos.
   * Usado pelo rate limit.
   */
  static async countRecentMessagesByUser(conn, id_user, seconds) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_chat_message
        WHERE id_user = $1
          AND deleted_at IS NULL
          AND created_at > NOW() - ($2 || ' seconds')::interval`,
      [id_user, seconds]
    );
    return rows[0]?.n || 0;
  }

  static async getLastMessageByUserInRoom(conn, { id_chat_room, id_user }) {
    const { rows } = await conn.query(
      `SELECT *
         FROM public.tb_chat_message
        WHERE id_chat_room = $1
          AND id_user = $2
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [id_chat_room, id_user]
    );
    return rows[0] || null;
  }

  static async insertMessage(conn, { id_chat_room, id_user, id_profile, content, message_type }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_chat_message
        (id_chat_room, id_user, id_profile, content, message_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id_chat_room, id_user, id_profile || null, content, message_type || "text"]
    );
    return rows[0];
  }

  /**
   * Lista mensagens de uma sala enriquecidas com dados do user e perfil
   * que enviou. Retorna ordenadas por created_at DESC (mais novas primeiro)
   * mas o consumidor inverte pra exibir.
   */
  static async listMessages(conn, { id_chat_room, before, limit = 50 }) {
    const args = [id_chat_room, Math.min(Math.max(1, limit), 100)];
    let cursorClause = "";
    if (before) {
      cursorClause = "AND m.created_at < $3";
      args.push(before);
    }
    const { rows } = await conn.query(
      `
      SELECT
        m.id_chat_message,
        m.id_chat_room,
        m.id_user,
        m.id_profile,
        m.content,
        m.message_type,
        m.created_at,
        m.deleted_at,
        m.hidden_at,
        m.hidden_reason,
        u.username        AS user_username,
        u.nome            AS user_nome,
        p.display_name    AS profile_display_name,
        p.avatar_url      AS profile_avatar_url,
        p.sub_profile_slug AS profile_slug,
        cat.id_machine    AS profile_machine_id,
        mac.name          AS profile_machine_name,
        mac.slug          AS profile_machine_slug,
        COALESCE(p.xp_level, 0)::int AS profile_xp_level
        FROM public.tb_chat_message m
        JOIN public.tb_user u ON u.id_user = m.id_user
        LEFT JOIN public.tb_profile p ON p.id_profile = m.id_profile AND p.deleted_at IS NULL
        LEFT JOIN public.tb_category cat ON cat.id_category = p.id_category
        LEFT JOIN public.tb_machine  mac ON mac.id_machine = cat.id_machine
       WHERE m.id_chat_room = $1
         AND m.deleted_at IS NULL
         ${cursorClause}
       ORDER BY m.created_at DESC
       LIMIT $2
      `,
      args
    );
    return rows;
  }

  static async getMessageById(conn, id_chat_message) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_chat_message WHERE id_chat_message = $1`,
      [id_chat_message]
    );
    return rows[0] || null;
  }

  static async softDeleteMessage(conn, id_chat_message) {
    await conn.query(
      `UPDATE public.tb_chat_message
          SET deleted_at = NOW()
        WHERE id_chat_message = $1
          AND deleted_at IS NULL`,
      [id_chat_message]
    );
  }

  // ----------------------------------------------------------------
  // Denúncias
  // ----------------------------------------------------------------

  static async insertReport(conn, { id_chat_message, id_reporter_user, reason, reason_category }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_chat_report
        (id_chat_message, id_reporter_user, reason, reason_category)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id_chat_message, id_reporter_user) DO NOTHING
       RETURNING *`,
      [id_chat_message, id_reporter_user, reason || null, reason_category || null]
    );
    return rows[0] || null;
  }

  // ----------------------------------------------------------------
  // Machines do user (deriva máquina principal)
  // ----------------------------------------------------------------

  /**
   * Lista máquinas distintas em que o user tem subperfis ativos não-clan
   * não-deletados. Ordena pela mais recente.
   */
  static async listUserMachines(conn, id_user) {
    const { rows } = await conn.query(
      `
      SELECT DISTINCT
        m.id_machine,
        m.name,
        m.slug,
        m.color_accent,
        MAX(p.created_at) AS last_used
        FROM public.tb_profile p
        JOIN public.tb_category c ON c.id_category = p.id_category
        JOIN public.tb_machine  m ON m.id_machine = c.id_machine
       WHERE p.id_user = $1
         AND p.deleted_at IS NULL
         AND p.is_active = TRUE
         AND COALESCE(p.is_clan, FALSE) = FALSE
       GROUP BY m.id_machine, m.name, m.slug, m.color_accent
       ORDER BY MAX(p.created_at) DESC
      `,
      [id_user]
    );
    return rows;
  }

  /**
   * Pega o primeiro id_profile não-clan/ativo do user na máquina informada,
   * usado pra anexar o perfil que envia a mensagem (badge no chat).
   */
  static async getUserProfileForMachine(conn, { id_user, id_machine }) {
    const { rows } = await conn.query(
      `SELECT p.id_profile
         FROM public.tb_profile p
         JOIN public.tb_category c ON c.id_category = p.id_category
        WHERE p.id_user = $1
          AND c.id_machine = $2
          AND p.deleted_at IS NULL
          AND p.is_active = TRUE
          AND COALESCE(p.is_clan, FALSE) = FALSE
        ORDER BY p.created_at DESC
        LIMIT 1`,
      [id_user, id_machine]
    );
    return rows[0]?.id_profile || null;
  }

  static async getUserAnyProfile(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT id_profile
         FROM public.tb_profile
        WHERE id_user = $1
          AND deleted_at IS NULL
          AND is_active = TRUE
          AND COALESCE(is_clan, FALSE) = FALSE
        ORDER BY created_at DESC
        LIMIT 1`,
      [id_user]
    );
    return rows[0]?.id_profile || null;
  }

  static async getMachineById(conn, id_machine) {
    const { rows } = await conn.query(
      `SELECT id_machine, name, slug, color_accent
         FROM public.tb_machine
        WHERE id_machine = $1`,
      [id_machine]
    );
    return rows[0] || null;
  }

  static async listAllActiveMachines(conn) {
    const { rows } = await conn.query(
      `SELECT id_machine, name, slug, color_accent
         FROM public.tb_machine
        WHERE COALESCE(is_active, TRUE) = TRUE
        ORDER BY id_machine ASC`
    );
    return rows;
  }

  /**
   * Reset diário: apaga TODO o histórico do chat ao vivo (Global + Máquinas).
   * Mantém salas, settings de moderação, blocked terms e reputação por usuário
   * (tb_chat_user_moderation_state) — apenas o histórico de mensagens some.
   *
   * tb_chat_presence também sai pra forçar rejoin "limpo" e ressetar contagem
   * de online.
   *
   * Pool é passado direto (não conn em transação) — abre client próprio.
   * Retorna contagens "antes" para o log.
   */
  static async dailyReset(pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const counts = {};
      for (const t of [
        "tb_chat_message",
        "tb_chat_report",
        "tb_chat_moderation_result",
        "tb_chat_presence",
      ]) {
        const { rows } = await client.query(
          `SELECT COUNT(*)::int AS total FROM public.${t}`
        );
        counts[t] = rows[0]?.total || 0;
      }

      // TRUNCATE com CASCADE garante consistência se houver FKs.
      // RESTART IDENTITY zera sequences (defensivo — algumas tabelas usam
      // gen_random_uuid e não têm sequence, mas não faz mal).
      await client.query(
        `TRUNCATE TABLE
           public.tb_chat_report,
           public.tb_chat_moderation_result,
           public.tb_chat_message,
           public.tb_chat_presence
         RESTART IDENTITY CASCADE`
      );

      await client.query("COMMIT");
      return counts;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = ChatStorage;
module.exports.ONLINE_WINDOW_SECONDS = ONLINE_WINDOW_SECONDS;
