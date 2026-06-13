const crypto = require("crypto");
const pool = require("../databases");
const BookingReminderStorage = require("../storages/BookingReminderStorage");
const { sendBookingReminderEmail } = require("./mailService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("BookingReminderService");

const WEB_URL =
  process.env.FRONTEND_URL || process.env.PUBLIC_WEB_URL || "https://www.freelandoo.com.br";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ymd(d) {
  if (!d) return "";
  if (typeof d === "string") return d.slice(0, 10);
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}
function dateLabelBR(d) {
  const s = ymd(d);
  if (!s) return "";
  // Noon evita cruzar fronteira de dia ao formatar (date-only).
  return new Date(`${s}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

class BookingReminderService {
  /**
   * Job: varre bookings confirmados dentro da janela de antecedência e dispara
   * o lembrete por e-mail (+ link de confirmação). Sem e-mail = marca enviado
   * (o profissional usa o botão wa.me de 1 toque no app). Falha de envio NÃO
   * marca → é retentado no próximo tick.
   */
  static async runDue() {
    const due = await BookingReminderStorage.findDueForReminder(pool, { limit: 100 });
    let sent = 0;
    let skipped = 0;
    for (const b of due) {
      const token = crypto.randomUUID();
      if (!b.client_email) {
        await BookingReminderStorage.markReminderSent(pool, b.id, token);
        skipped++;
        continue;
      }
      try {
        await sendBookingReminderEmail({
          to: b.client_email,
          clientName: b.client_name || "",
          proName: b.pro_name || "Freelandoo",
          dateLabel: dateLabelBR(b.booking_date),
          timeLabel: String(b.start_time || "").slice(0, 5),
          confirmUrl: `${WEB_URL}/agendamento/confirmar/${token}`,
        });
        await BookingReminderStorage.markReminderSent(pool, b.id, token);
        sent++;
      } catch (err) {
        log.error("send_fail", { id: b.id, message: err.message });
      }
    }
    return { due: due.length, sent, skipped };
  }

  /** Público: dados mínimos do agendamento para a tela de confirmação. */
  static async getConfirmInfo(token) {
    return runWithLogs(
      log,
      "getConfirmInfo",
      () => ({ token }),
      async () => {
        if (!UUID_RE.test(String(token || ""))) return { error: "Token inválido", status: 400 };
        const b = await BookingReminderStorage.findByConfirmToken(pool, token);
        if (!b) return { error: "Agendamento não encontrado", status: 404 };
        return {
          booking: {
            client_name: b.client_name,
            pro_name: b.pro_name,
            booking_date: ymd(b.booking_date),
            start_time: String(b.start_time || "").slice(0, 5),
            status: b.status,
            client_confirm_status: b.client_confirm_status,
          },
        };
      }
    );
  }

  /** Público: cliente confirma presença ou pede pra remarcar. */
  static async submitConfirm(token, action) {
    return runWithLogs(
      log,
      "submitConfirm",
      () => ({ token, action }),
      async () => {
        if (!UUID_RE.test(String(token || ""))) return { error: "Token inválido", status: 400 };
        const status =
          action === "reschedule" ? "reschedule" : action === "confirm" ? "confirmed" : null;
        if (!status) return { error: "Ação inválida", status: 400 };
        const row = await BookingReminderStorage.setClientConfirm(pool, token, status);
        if (!row) return { error: "Agendamento não encontrado", status: 404 };
        return { ok: true, client_confirm_status: status };
      }
    );
  }
}

module.exports = BookingReminderService;
