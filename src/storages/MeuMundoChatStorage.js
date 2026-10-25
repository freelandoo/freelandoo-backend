// src/storages/MeuMundoChatStorage.js — MEU MUNDO 3D mm3d-32. SQL parametrizado.

class MeuMundoChatStorage {
  /** A sala do Global do jogo (uma só, índice único da mig 303). */
  static async ensureRoom(conn) {
    const found = await conn.query(
      `SELECT * FROM public.tb_chat_room WHERE type = 'meu_mundo' AND status = 'active' LIMIT 1`
    );
    if (found.rows[0]) return found.rows[0];
    await conn.query(
      `INSERT INTO public.tb_chat_room (type, instance_number, max_users, display_name, internal_name, status)
       VALUES ('meu_mundo', 1, 100000, 'Meu Mundo', 'meu_mundo_global', 'active')
       ON CONFLICT DO NOTHING`
    );
    const again = await conn.query(
      `SELECT * FROM public.tb_chat_room WHERE type = 'meu_mundo' AND status = 'active' LIMIT 1`
    );
    return again.rows[0] || null;
  }

  /** Todos os bloqueios em que a conta aparece (nos dois sentidos). */
  static async blockPairs(conn, userId) {
    const r = await conn.query(
      `SELECT blocker_user_id, blocked_user_id FROM public.tb_user_block
        WHERE blocker_user_id = $1 OR blocked_user_id = $1`,
      [userId]
    );
    return r.rows;
  }

  /** A mensagem existe e é desta sala? (denúncia pelo jogo só vale para o Global do jogo) */
  static async messageInRoom(conn, idChatMessage, idChatRoom) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_chat_message
        WHERE id_chat_message = $1 AND id_chat_room = $2 AND deleted_at IS NULL`,
      [idChatMessage, idChatRoom]
    );
    return r.rowCount > 0;
  }

  /** Perfil-conta a partir de um id de perfil (só perfil-conta vivo). */
  static async accountProfileById(conn, profileId) {
    const r = await conn.query(
      `SELECT id_profile, id_user FROM public.tb_profile
        WHERE id_profile = $1 AND is_user_account = TRUE AND deleted_at IS NULL`,
      [profileId]
    );
    return r.rows[0] || null;
  }
}

module.exports = MeuMundoChatStorage;
