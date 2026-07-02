// src/storages/ApiConnectionStorage.js
// SQL puro das conexões de API (tokens pessoais) e da fila de webhook.

class ApiConnectionStorage {
  static async listForUser(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT id_connection, name, token_prefix, scope_personal, webhook_url,
              status, last_used_at, last_ip, created_at, revoked_at
         FROM public.tb_api_connection
        WHERE id_user = $1
        ORDER BY created_at DESC`,
      [id_user]
    );
    return rows;
  }

  static async countActiveForUser(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS c
         FROM public.tb_api_connection
        WHERE id_user = $1 AND status = 'active'`,
      [id_user]
    );
    return rows[0]?.c || 0;
  }

  static async create(conn, { id_user, name, token_hash, token_prefix, scope_personal, webhook_secret }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_api_connection
         (id_user, name, token_hash, token_prefix, scope_personal, webhook_secret)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id_connection, name, token_prefix, scope_personal, status, created_at`,
      [id_user, name, token_hash, token_prefix, scope_personal, webhook_secret]
    );
    return rows[0] || null;
  }

  static async getActiveByTokenHash(conn, token_hash) {
    const { rows } = await conn.query(
      `SELECT id_connection, id_user, name, scope_personal, webhook_url,
              webhook_secret, status, created_at
         FROM public.tb_api_connection
        WHERE token_hash = $1 AND status = 'active'`,
      [token_hash]
    );
    return rows[0] || null;
  }

  static async getByIdForUser(conn, { id_connection, id_user }) {
    const { rows } = await conn.query(
      `SELECT id_connection, id_user, name, status
         FROM public.tb_api_connection
        WHERE id_connection = $1 AND id_user = $2`,
      [id_connection, id_user]
    );
    return rows[0] || null;
  }

  static async revoke(conn, { id_connection, id_user }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_api_connection
          SET status = 'revoked', revoked_at = NOW()
        WHERE id_connection = $1 AND id_user = $2 AND status = 'active'
        RETURNING id_connection, status, revoked_at`,
      [id_connection, id_user]
    );
    return rows[0] || null;
  }

  // Touch com throttle embutido no SQL: só grava se o último uso for > 60s.
  static async touchLastUsed(conn, { id_connection, ip }) {
    await conn.query(
      `UPDATE public.tb_api_connection
          SET last_used_at = NOW(), last_ip = $2
        WHERE id_connection = $1
          AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '60 seconds')`,
      [id_connection, ip || null]
    );
  }

  static async setWebhookUrl(conn, { id_connection, webhook_url }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_api_connection
          SET webhook_url = $2
        WHERE id_connection = $1 AND status = 'active'
        RETURNING id_connection, webhook_url, webhook_secret`,
      [id_connection, webhook_url]
    );
    return rows[0] || null;
  }

  // ── Fila de webhook ────────────────────────────────────────────────────────
  static async enqueueDelivery(conn, { id_connection, event_type, payload }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_api_webhook_delivery (id_connection, event_type, payload)
       VALUES ($1, $2, $3::jsonb)
       RETURNING *`,
      [id_connection, event_type, JSON.stringify(payload)]
    );
    return rows[0] || null;
  }

  static async listDueDeliveries(conn, limit = 20) {
    const { rows } = await conn.query(
      `SELECT d.*, c.webhook_url, c.webhook_secret, c.status AS connection_status
         FROM public.tb_api_webhook_delivery d
         JOIN public.tb_api_connection c ON c.id_connection = d.id_connection
        WHERE d.status = 'pending' AND d.next_attempt_at <= NOW()
        ORDER BY d.next_attempt_at ASC
        LIMIT $1`,
      [limit]
    );
    return rows;
  }

  static async markDelivered(conn, id_delivery) {
    await conn.query(
      `UPDATE public.tb_api_webhook_delivery
          SET status = 'delivered', delivered_at = NOW()
        WHERE id_delivery = $1`,
      [id_delivery]
    );
  }

  static async scheduleRetry(conn, { id_delivery, attempts, next_attempt_at, last_error, failed }) {
    await conn.query(
      `UPDATE public.tb_api_webhook_delivery
          SET attempts = $2,
              next_attempt_at = $3,
              last_error = $4,
              status = CASE WHEN $5 THEN 'failed' ELSE 'pending' END
        WHERE id_delivery = $1`,
      [id_delivery, attempts, next_attempt_at, String(last_error || "").slice(0, 500), !!failed]
    );
  }
}

module.exports = ApiConnectionStorage;
