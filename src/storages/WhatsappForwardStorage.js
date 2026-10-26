// src/storages/WhatsappForwardStorage.js
// Repasse do WhatsApp oficial para o sistema da academia (mig 307). SQL PURO —
// a ingestão importa este módulo, e ele não pode alcançar nada que envie.

class WhatsappForwardStorage {
  // A primeira tentativa é a imediata do dispatcher; os 30s de folga impedem o
  // sweeper de pegar a mesma linha enquanto ela ainda está em voo.
  static async enqueue(conn, id_academy, payload) {
    const r = await conn.query(
      `INSERT INTO public.tb_whatsapp_forward_delivery (id_academy, payload, next_attempt_at)
       VALUES ($1, $2::jsonb, NOW() + INTERVAL '30 seconds')
       RETURNING id_delivery, id_academy, payload, attempts`,
      [id_academy, JSON.stringify(payload)]
    );
    return r.rows[0];
  }

  static async listDue(conn, limit = 50) {
    const r = await conn.query(
      `SELECT id_delivery, id_academy, payload, attempts
         FROM public.tb_whatsapp_forward_delivery
        WHERE delivered_at IS NULL AND failed_at IS NULL AND next_attempt_at <= NOW()
        ORDER BY id_delivery
        LIMIT $1`,
      [limit]
    );
    return r.rows;
  }

  static async markDelivered(conn, id_delivery) {
    await conn.query(
      `UPDATE public.tb_whatsapp_forward_delivery SET delivered_at = NOW(), last_error = NULL
        WHERE id_delivery = $1`,
      [id_delivery]
    );
  }

  static async scheduleRetry(conn, { id_delivery, attempts, next_attempt_at, last_error, failed }) {
    await conn.query(
      `UPDATE public.tb_whatsapp_forward_delivery
          SET attempts = $2, next_attempt_at = $3, last_error = LEFT($4, 500),
              failed_at = CASE WHEN $5::boolean THEN NOW() ELSE NULL END
        WHERE id_delivery = $1`,
      [id_delivery, attempts, next_attempt_at, last_error || null, !!failed]
    );
  }

  /** Para onde e com que segredo assinar. `null` = academia sem webhook. */
  static async getWebhook(conn, id_academy) {
    const r = await conn.query(
      `SELECT whatsapp_webhook_url AS url, whatsapp_webhook_secret_sealed AS secret_sealed
         FROM public.tb_academy WHERE id_academy = $1`,
      [id_academy]
    );
    const row = r.rows[0];
    return row && row.url && row.secret_sealed ? row : null;
  }

  static async setWebhook(conn, id_academy, { url, secret_sealed }) {
    await conn.query(
      `UPDATE public.tb_academy
          SET whatsapp_webhook_url = $2, whatsapp_webhook_secret_sealed = $3
        WHERE id_academy = $1`,
      [id_academy, url, secret_sealed]
    );
  }

  /** O número oficial que atende pela academia (no máximo um — índice único). */
  static async getAcademyInstance(conn, id_academy) {
    const r = await conn.query(
      `SELECT id_instance, id_user, provider, evolution_instance, waba_id, status,
              connected_number, quality_rating, number_status, id_academy_forward
         FROM public.tb_whatsapp_instance
        WHERE id_academy_forward = $1
        LIMIT 1`,
      [id_academy]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /** Liga (ou desliga, com null) o número de quem é dono à academia. */
  static async setForward(conn, id_instance, id_academy) {
    await conn.query(
      `UPDATE public.tb_whatsapp_instance SET id_academy_forward = $2 WHERE id_instance = $1`,
      [id_instance, id_academy]
    );
  }

  /** A conversa de um telefone no número da academia (com a janela de 24h). */
  static async getConversationByPhone(conn, id_instance, phone) {
    const r = await conn.query(
      `SELECT id_conversation, id_instance, remote_jid, phone, service_window_expires_at
         FROM public.tb_whatsapp_conversation
        WHERE id_instance = $1 AND remote_jid = $2
        LIMIT 1`,
      [id_instance, `${phone}@s.whatsapp.net`]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /** A mídia pedida é mesmo de uma mensagem do número desta academia? */
  static async mediaBelongsToAcademy(conn, id_academy, media_id) {
    const r = await conn.query(
      `SELECT 1
         FROM public.tb_whatsapp_message m
         JOIN public.tb_whatsapp_conversation c ON c.id_conversation = m.id_conversation
         JOIN public.tb_whatsapp_instance i ON i.id_instance = c.id_instance
        WHERE m.media_id = $2 AND i.id_academy_forward = $1
        LIMIT 1`,
      [id_academy, media_id]
    );
    return r.rowCount > 0;
  }
}

module.exports = WhatsappForwardStorage;
