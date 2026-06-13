/**
 * BookingReminderStorage — fila do lembrete de horário (anti-no-show) e
 * confirmação do cliente por token. SQL puro.
 *
 * "Devido" = booking confirmado, futuro, dentro da janela de antecedência do
 * subperfil (reminder_hours_before, default 24h), ainda sem lembrete enviado.
 * Datas/horas são locais (DATE+TIME) interpretadas no fuso de São Paulo.
 */

const SP_TZ = "America/Sao_Paulo";

class BookingReminderStorage {
  static async findDueForReminder(conn, { limit = 100 } = {}) {
    const r = await conn.query(
      `
      SELECT
        b.id, b.client_name, b.client_email, b.client_whatsapp,
        b.booking_date, b.start_time, b.id_profile,
        p.display_name AS pro_name
      FROM public.tb_profile_bookings b
      JOIN public.tb_profile p ON p.id_profile = b.id_profile
      LEFT JOIN public.tb_profile_booking_settings s ON s.id_profile = b.id_profile
      WHERE b.status = 'confirmed'
        AND b.reminder_sent_at IS NULL
        AND COALESCE(s.reminder_enabled, TRUE) = TRUE
        AND ((b.booking_date + b.start_time) AT TIME ZONE '${SP_TZ}') > NOW()
        AND ((b.booking_date + b.start_time) AT TIME ZONE '${SP_TZ}')
            <= NOW() + (COALESCE(s.reminder_hours_before, 24) * INTERVAL '1 hour')
      ORDER BY b.booking_date, b.start_time
      LIMIT $1
      `,
      [limit]
    );
    return r.rows;
  }

  static async markReminderSent(conn, id, token) {
    await conn.query(
      `UPDATE public.tb_profile_bookings
          SET reminder_sent_at = NOW(), confirm_token = $2, updated_at = NOW()
        WHERE id = $1`,
      [id, token]
    );
  }

  static async findByConfirmToken(conn, token) {
    const r = await conn.query(
      `
      SELECT
        b.id, b.client_name, b.booking_date, b.start_time, b.status,
        b.client_confirm_status, p.display_name AS pro_name
      FROM public.tb_profile_bookings b
      JOIN public.tb_profile p ON p.id_profile = b.id_profile
      WHERE b.confirm_token = $1
      `,
      [token]
    );
    return r.rows[0] || null;
  }

  static async setClientConfirm(conn, token, status) {
    const r = await conn.query(
      `UPDATE public.tb_profile_bookings
          SET client_confirm_status = $2, updated_at = NOW()
        WHERE confirm_token = $1
        RETURNING id`,
      [token, status]
    );
    return r.rows[0] || null;
  }
}

module.exports = BookingReminderStorage;
