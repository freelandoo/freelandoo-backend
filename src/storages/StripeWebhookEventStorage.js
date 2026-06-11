class StripeWebhookEventStorage {
  /**
   * Reivindica um evento para processamento (at-least-once). Insere como
   * 'pending' se novo; se já existe mas ainda NÃO está 'done', re-reivindica
   * (incrementa attempts) — é o caminho do retry do Stripe após uma falha.
   *
   * Retorna:
   *   { row, duplicate:false } → processar (novo ou re-reivindicado)
   *   { row:null, duplicate:true } → já concluído ('done'), pular.
   */
  static async claim(conn, { event_id, event_type, payload }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_stripe_webhook_event
         (event_id, event_type, payload, status, attempts)
       VALUES ($1, $2, $3, 'pending', 1)
       ON CONFLICT (event_id) DO UPDATE
         SET attempts = public.tb_stripe_webhook_event.attempts + 1,
             updated_at = NOW()
       WHERE public.tb_stripe_webhook_event.status <> 'done'
       RETURNING id_event, event_id, event_type, status, attempts`,
      [event_id, event_type, payload]
    );
    if (rows[0]) return { row: rows[0], duplicate: false };
    // Sem linha = conflito numa linha já 'done' (o WHERE bloqueou o UPDATE).
    return { row: null, duplicate: true };
  }

  static async markDone(conn, event_id) {
    await conn.query(
      `UPDATE public.tb_stripe_webhook_event
          SET status = 'done', completed_at = NOW(), last_error = NULL, updated_at = NOW()
        WHERE event_id = $1`,
      [event_id]
    );
  }

  static async markFailed(conn, event_id, message) {
    await conn.query(
      `UPDATE public.tb_stripe_webhook_event
          SET status = 'failed', last_error = $2, updated_at = NOW()
        WHERE event_id = $1`,
      [event_id, message ? String(message).slice(0, 2000) : null]
    );
  }

  static async getByEventId(conn, event_id) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_stripe_webhook_event WHERE event_id = $1 LIMIT 1`,
      [event_id]
    );
    return rows[0] || null;
  }

  /**
   * Lista para o painel admin de pagamentos. status opcional ('failed'|'pending'
   * |'done'). Sem status → tudo, mais recentes primeiro.
   */
  static async listForAdmin(conn, { status = null, limit = 50, offset = 0 } = {}) {
    const params = [];
    let where = "";
    if (status) {
      params.push(status);
      where = `WHERE status = $${params.length}`;
    }
    params.push(limit, offset);
    const { rows } = await conn.query(
      `SELECT id_event, event_id, event_type, status, attempts, last_error,
              processed_at, completed_at, updated_at
         FROM public.tb_stripe_webhook_event
         ${where}
         ORDER BY processed_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return rows;
  }

  static async countByStatus(conn) {
    const { rows } = await conn.query(
      `SELECT status, COUNT(*)::int AS count
         FROM public.tb_stripe_webhook_event
        GROUP BY status`
    );
    return rows.reduce((acc, r) => ({ ...acc, [r.status]: r.count }), {});
  }
}

module.exports = StripeWebhookEventStorage;
