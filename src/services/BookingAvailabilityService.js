const pool = require("../databases");
const BookingAvailabilityStorage = require("../storages/BookingAvailabilityStorage");
const BookingSettingsStorage = require("../storages/BookingSettingsStorage");
const BookingStorage = require("../storages/BookingStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const { createLogger } = require("../utils/logger");

const log = createLogger("BookingAvailabilityService");

/**
 * Gera slots de horário com base em start/end/duration/buffer.
 * Retorna array de { start: "HH:MM", end: "HH:MM" }.
 */
function generateSlots(startTime, endTime, durationMin, bufferMin) {
  const slots = [];
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  let cursor = startMinutes;
  while (cursor + durationMin <= endMinutes) {
    const slotStart = `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`;
    const slotEndMin = cursor + durationMin;
    const slotEnd = `${String(Math.floor(slotEndMin / 60)).padStart(2, "0")}:${String(slotEndMin % 60).padStart(2, "0")}`;
    slots.push({ start: slotStart, end: slotEnd });
    cursor += durationMin + bufferMin;
  }
  return slots;
}

class BookingAvailabilityService {
  // ─── Owner: salvar regras semanais ──────────────────────────────────
  static async saveWeeklyRules(user, params, body) {
    const { id_profile } = params;
    const profile = await ProfileStorage.getProfileById(pool, id_profile);
    if (!profile) return { error: "Perfil não encontrado" };
    if (String(profile.id_user) !== String(user.id_user)) return { error: "Sem permissão" };

    const { rules } = body; // array de { weekday, is_enabled, start_time, end_time, slot_duration_minutes, buffer_minutes }
    if (!Array.isArray(rules)) return { error: "Campo 'rules' é obrigatório e deve ser um array" };

    const results = [];
    for (const rule of rules) {
      if (rule.weekday == null || rule.weekday < 0 || rule.weekday > 6) continue;
      const saved = await BookingAvailabilityStorage.upsertWeeklyRule(pool, {
        id_profile,
        weekday: rule.weekday,
        is_enabled: !!rule.is_enabled,
        start_time: rule.start_time || "08:00",
        end_time: rule.end_time || "18:00",
        slot_duration_minutes: rule.slot_duration_minutes || 60,
        buffer_minutes: rule.buffer_minutes || 0,
      });
      results.push(saved);
    }
    return { rules: results };
  }

  static async getWeeklyRules(user, params) {
    const { id_profile } = params;
    const profile = await ProfileStorage.getProfileById(pool, id_profile);
    if (!profile) return { error: "Perfil não encontrado" };
    if (String(profile.id_user) !== String(user.id_user)) return { error: "Sem permissão" };

    const rules = await BookingAvailabilityStorage.getWeeklyRules(pool, id_profile);
    return { rules };
  }

  // ─── Owner: exceções por data ───────────────────────────────────────
  static async saveOverride(user, params, body) {
    const { id_profile } = params;
    const profile = await ProfileStorage.getProfileById(pool, id_profile);
    if (!profile) return { error: "Perfil não encontrado" };
    if (String(profile.id_user) !== String(user.id_user)) return { error: "Sem permissão" };

    if (!body.override_date) return { error: "Data é obrigatória" };

    const saved = await BookingAvailabilityStorage.upsertOverride(pool, {
      id_profile,
      override_date: body.override_date,
      is_day_blocked: !!body.is_day_blocked,
      custom_start_time: body.custom_start_time,
      custom_end_time: body.custom_end_time,
      extra_slots_json: body.extra_slots_json,
      blocked_slots_json: body.blocked_slots_json,
      note: body.note,
    });
    return { override: saved };
  }

  static async getOverrides(user, params) {
    const { id_profile } = params;
    const profile = await ProfileStorage.getProfileById(pool, id_profile);
    if (!profile) return { error: "Perfil não encontrado" };
    if (String(profile.id_user) !== String(user.id_user)) return { error: "Sem permissão" };

    const overrides = await BookingAvailabilityStorage.getOverrides(pool, id_profile);
    return { overrides };
  }

  static async deleteOverride(user, params) {
    const { id_profile, overrideId } = params;
    const profile = await ProfileStorage.getProfileById(pool, id_profile);
    if (!profile) return { error: "Perfil não encontrado" };
    if (String(profile.id_user) !== String(user.id_user)) return { error: "Sem permissão" };

    const deleted = await BookingAvailabilityStorage.deleteOverride(pool, overrideId, id_profile);
    if (!deleted) return { error: "Exceção não encontrada" };
    return { deleted: true };
  }

  // ─── Owner: configurações de sinal ──────────────────────────────────
  static async getBookingSettings(user, params) {
    const { id_profile } = params;
    const profile = await ProfileStorage.getProfileById(pool, id_profile);
    if (!profile) return { error: "Perfil não encontrado" };
    if (String(profile.id_user) !== String(user.id_user)) return { error: "Sem permissão" };

    const settings = await BookingSettingsStorage.get(pool, id_profile);
    return { settings: settings || { deposit_amount: 1000, platform_fee_amount: 1000, currency: "BRL", allow_booking: false } };
  }

  static async saveBookingSettings(user, params, body) {
    const { id_profile } = params;
    const profile = await ProfileStorage.getProfileById(pool, id_profile);
    if (!profile) return { error: "Perfil não encontrado" };
    if (String(profile.id_user) !== String(user.id_user)) return { error: "Sem permissão" };

    // deposit_amount foi aposentado — checkout usa price_amount do serviço.
    // Aceita apenas allow_booking. Mantém deposit_amount legacy intocado quando não enviado.
    const payload = { id_profile };
    if (Object.prototype.hasOwnProperty.call(body || {}, "allow_booking")) {
      payload.allow_booking = !!body.allow_booking;
    }

    const saved = await BookingSettingsStorage.upsert(pool, payload);
    return { settings: saved };
  }

  // ─── Público: horários disponíveis para um dia ──────────────────────
  static async getAvailableSlots(id_profile, dateStr) {
    if (!dateStr) return { error: "Data é obrigatória" };

    const profile = await ProfileStorage.getProfileById(pool, id_profile);
    if (!profile) return { error: "Perfil não encontrado" };
    if (profile.deleted_at) return { error: "Perfil não encontrado" };
    if (!profile.is_visible) return { error: "Perfil indisponível" };

    // Verificar se o perfil tem assinatura ativa
    const settings = await BookingSettingsStorage.get(pool, id_profile);
    if (!settings || !settings.allow_booking) {
      return { slots: [], message: "Agenda indisponível" };
    }

    const targetDate = new Date(dateStr + "T12:00:00Z");
    const weekday = targetDate.getUTCDay(); // 0=dom, 6=sab
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (targetDate < today) return { slots: [], message: "Data no passado" };

    // Pegar regra para a data (override tem prioridade)
    const rule = await BookingAvailabilityStorage.getRuleForDate(pool, id_profile, dateStr, weekday);

    if (rule.type === "none") return { slots: [] };

    if (rule.type === "override") {
      const ov = rule.data;
      if (ov.is_day_blocked) return { slots: [], message: "Dia bloqueado" };

      // Pegar regra semanal para duração/buffer defaults
      const weeklyRules = await BookingAvailabilityStorage.getWeeklyRules(pool, id_profile);
      const weeklyRule = weeklyRules.find(r => r.weekday === weekday);
      const duration = weeklyRule?.slot_duration_minutes || 60;
      const buffer = weeklyRule?.buffer_minutes || 0;

      let slots = [];

      // Slots baseados no horário customizado
      if (ov.custom_start_time && ov.custom_end_time) {
        slots = generateSlots(ov.custom_start_time, ov.custom_end_time, duration, buffer);
      } else if (weeklyRule && weeklyRule.is_enabled) {
        slots = generateSlots(weeklyRule.start_time, weeklyRule.end_time, duration, buffer);
      }

      // Adicionar slots extras
      if (ov.extra_slots_json) {
        const extras = typeof ov.extra_slots_json === "string"
          ? JSON.parse(ov.extra_slots_json) : ov.extra_slots_json;
        for (const t of extras) {
          const [h, m] = t.split(":").map(Number);
          const endMin = h * 60 + m + duration;
          const endStr = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
          if (!slots.find(s => s.start === t)) {
            slots.push({ start: t, end: endStr });
          }
        }
      }

      // Remover slots bloqueados
      if (ov.blocked_slots_json) {
        const blocked = typeof ov.blocked_slots_json === "string"
          ? JSON.parse(ov.blocked_slots_json) : ov.blocked_slots_json;
        slots = slots.filter(s => !blocked.includes(s.start));
      }

      // Ordenar
      slots.sort((a, b) => a.start.localeCompare(b.start));

      // Remover slots já reservados
      const bookings = await BookingStorage.getActiveBookingsForDate(pool, id_profile, dateStr);
      const bookedTimes = new Set(bookings.map(b => b.start_time.substring(0, 5)));
      slots = slots.filter(s => !bookedTimes.has(s.start));

      // Remover slots no passado (se for hoje)
      const now = new Date();
      const todayStr = now.toISOString().substring(0, 10);
      if (dateStr === todayStr) {
        const nowMin = now.getHours() * 60 + now.getMinutes();
        slots = slots.filter(s => {
          const [sh, sm] = s.start.split(":").map(Number);
          return sh * 60 + sm > nowMin;
        });
      }

      return { slots };
    }

    // Tipo "weekly"
    const wr = rule.data;
    if (!wr.is_enabled) return { slots: [] };

    let slots = generateSlots(wr.start_time, wr.end_time, wr.slot_duration_minutes, wr.buffer_minutes);

    // Remover slots já reservados
    const bookings = await BookingStorage.getActiveBookingsForDate(pool, id_profile, dateStr);
    const bookedTimes = new Set(bookings.map(b => b.start_time.substring(0, 5)));
    slots = slots.filter(s => !bookedTimes.has(s.start));

    // Remover slots no passado (se for hoje)
    const now = new Date();
    const todayStr = now.toISOString().substring(0, 10);
    if (dateStr === todayStr) {
      const nowMin = now.getHours() * 60 + now.getMinutes();
      slots = slots.filter(s => {
        const [sh, sm] = s.start.split(":").map(Number);
        return sh * 60 + sm > nowMin;
      });
    }

    return { slots };
  }
}

module.exports = BookingAvailabilityService;
