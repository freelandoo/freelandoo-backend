// src/storages/AppLinkStorage.js
//
// Códigos de vínculo e sessões do app nativo (mig 278). SQL puro; todo método
// recebe `db` (pool ou client de transação), como os outros storages.

class AppLinkStorage {
  /** Um código vivo por pessoa: gerar outro mata o anterior. */
  static async invalidateLiveCodes(db, id_user) {
    await db.query(
      `UPDATE tb_app_link_code SET used_at = NOW()
        WHERE id_user = $1 AND used_at IS NULL`,
      [id_user]
    );
  }

  static async createCode(db, { id_user, code_hash, ttl_seconds }) {
    const r = await db.query(
      `INSERT INTO tb_app_link_code (id_user, code_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 second'))
       RETURNING id_link_code, expires_at`,
      [id_user, code_hash, ttl_seconds]
    );
    return r.rows[0];
  }

  /**
   * Consome o código numa instrução só: é o UPDATE condicional que garante o
   * uso único mesmo com duas trocas simultâneas (só uma recebe a linha).
   */
  static async consumeCode(db, code_hash) {
    const r = await db.query(
      `UPDATE tb_app_link_code
          SET used_at = NOW()
        WHERE code_hash = $1
          AND used_at IS NULL
          AND expires_at > NOW()
      RETURNING id_user`,
      [code_hash]
    );
    return r.rowCount ? r.rows[0].id_user : null;
  }

  static async getUserForApp(db, id_user) {
    const r = await db.query(
      `SELECT id_user, nome, username, email, avatar, blocked_at
         FROM tb_user WHERE id_user = $1 LIMIT 1`,
      [id_user]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async createSession(db, { id_user, token_hash, device_label }) {
    const r = await db.query(
      `INSERT INTO tb_app_session (id_user, token_hash, device_label)
       VALUES ($1, $2, $3)
       RETURNING id_app_session, created_at`,
      [id_user, token_hash, device_label || null]
    );
    return r.rows[0];
  }

  /** Sessão viva pelo hash do refresh token, carimbando o uso. */
  static async touchLiveSession(db, token_hash) {
    const r = await db.query(
      `UPDATE tb_app_session SET last_used_at = NOW()
        WHERE token_hash = $1 AND revoked_at IS NULL
      RETURNING id_app_session, id_user`,
      [token_hash]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async revokeByToken(db, token_hash) {
    const r = await db.query(
      `UPDATE tb_app_session SET revoked_at = NOW()
        WHERE token_hash = $1 AND revoked_at IS NULL`,
      [token_hash]
    );
    return r.rowCount > 0;
  }

  /** Revoga só se a sessão for DESTA pessoa (o id vem da URL). */
  static async revokeForUser(db, id_user, id_app_session) {
    const r = await db.query(
      `UPDATE tb_app_session SET revoked_at = NOW()
        WHERE id_app_session = $1 AND id_user = $2 AND revoked_at IS NULL`,
      [id_app_session, id_user]
    );
    return r.rowCount > 0;
  }

  static async listLiveForUser(db, id_user) {
    const r = await db.query(
      `SELECT id_app_session, app, device_label, created_at, last_used_at
         FROM tb_app_session
        WHERE id_user = $1 AND revoked_at IS NULL
        ORDER BY last_used_at DESC`,
      [id_user]
    );
    return r.rows;
  }
}

module.exports = AppLinkStorage;
