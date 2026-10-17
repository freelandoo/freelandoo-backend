// Bloqueio SOCIAL entre contas (mig 283). SQL parametrizado. A identidade
// canônica é a conta: o perfil por onde se bloqueou é só rótulo de tela.

class UserBlockStorage {
  static async block(conn, { blocker_user_id, blocked_user_id, via_profile_id = null }) {
    const r = await conn.query(
      `INSERT INTO public.tb_user_block (blocker_user_id, blocked_user_id, via_profile_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING
       RETURNING created_at`,
      [blocker_user_id, blocked_user_id, via_profile_id]
    );
    return r.rowCount === 1;
  }

  static async unblock(conn, { blocker_user_id, blocked_user_id }) {
    const r = await conn.query(
      `DELETE FROM public.tb_user_block WHERE blocker_user_id = $1 AND blocked_user_id = $2`,
      [blocker_user_id, blocked_user_id]
    );
    return r.rowCount === 1;
  }

  /** Há bloqueio em QUALQUER sentido entre as duas contas? */
  static async eitherBlocks(conn, a, b) {
    if (!a || !b || String(a) === String(b)) return false;
    const r = await conn.query(
      `SELECT 1 FROM public.tb_user_block
        WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
           OR (blocker_user_id = $2 AND blocked_user_id = $1)
        LIMIT 1`,
      [a, b]
    );
    return r.rowCount > 0;
  }

  static async iBlocked(conn, blocker_user_id, blocked_user_id) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_user_block WHERE blocker_user_id = $1 AND blocked_user_id = $2`,
      [blocker_user_id, blocked_user_id]
    );
    return r.rowCount > 0;
  }

  /** Lista de quem EU bloqueei (nunca quem me bloqueou). */
  static async listMine(conn, blocker_user_id) {
    const r = await conn.query(
      `SELECT b.created_at,
              COALESCE(b.via_profile_id, acc.id_profile) AS id_profile,
              COALESCE(vp.display_name, acc.display_name) AS display_name,
              COALESCE(vp.avatar_url, acc.avatar_url) AS avatar_url,
              u.username
         FROM public.tb_user_block b
         JOIN public.tb_user u ON u.id_user = b.blocked_user_id
         LEFT JOIN public.tb_profile vp ON vp.id_profile = b.via_profile_id AND vp.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT p.id_profile, p.display_name, p.avatar_url
             FROM public.tb_profile p
            WHERE p.id_user = b.blocked_user_id AND p.is_user_account = TRUE AND p.deleted_at IS NULL
            LIMIT 1
         ) acc ON TRUE
        WHERE b.blocker_user_id = $1
        ORDER BY b.created_at DESC
        LIMIT 500`,
      [blocker_user_id]
    );
    return r.rows;
  }

  /** Dono (conta) de uma entidade de mensagem: perfil → id_user; clan → dono do clan. */
  static async ownerOfEntity(conn, id_profile) {
    if (!id_profile) return null;
    const r = await conn.query(
      `SELECT p.id_user, p.is_clan FROM public.tb_profile p WHERE p.id_profile = $1 LIMIT 1`,
      [id_profile]
    );
    return r.rows[0]?.id_user || null;
  }

  /** Estado de sanção da conta (plataforma), não o bloqueio social. */
  static async accountState(conn, id_user) {
    const r = await conn.query(
      `SELECT id_user, ativo, blocked_at FROM public.tb_user WHERE id_user = $1`,
      [id_user]
    );
    return r.rows[0] || null;
  }
}

module.exports = UserBlockStorage;
