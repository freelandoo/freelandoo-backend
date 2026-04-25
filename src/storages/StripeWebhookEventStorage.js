class StripeWebhookEventStorage {
  /**
   * Tenta registrar o evento. Retorna a linha criada ou null se já existia
   * (idempotência via UNIQUE em event_id).
   */
  static async recordIfNew(conn, { event_id, event_type, payload }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_stripe_webhook_event (event_id, event_type, payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id_event, event_id, event_type, processed_at`,
      [event_id, event_type, payload]
    );
    return rows[0] || null;
  }
}

module.exports = StripeWebhookEventStorage;
