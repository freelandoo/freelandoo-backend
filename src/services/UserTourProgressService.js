const pool = require("../databases");
const UserTourProgressStorage = require("../storages/UserTourProgressStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("UserTourProgressService");

const ALLOWED_TOUR_KEYS = new Set([
  "welcome",
  "account_auth",
  "profile",
  "subprofiles",
  "enxames",
  "feed",
  "messages_private",
  "groups",
  "global_chat_rooms",
  "service_orders",
  "courses",
  "subprofile_store",
  "products",
  "pollens",
  "manifestations",
  "coupons",
  "affiliates",
  "ranking",
  "xp_levels",
  "premium_highlight",
  "booking",
  "admin",
  "moderation",
  "uploads_r2",
  "payments",
  "internationalization",
  "notifications",
  "security",
]);

const ALLOWED_STATUS = new Set(["not_started", "in_progress", "completed", "skipped"]);

function normalizeProgressRow(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    tour_key: row.tour_key,
    status: row.status,
    current_step: row.current_step,
    completed_at: row.completed_at,
    skipped_at: row.skipped_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

class UserTourProgressService {
  static async list(user) {
    return runWithLogs(log, "list", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Usuário não autenticado" };
      const rows = await UserTourProgressStorage.listByUser(pool, user.id_user);
      const settings = await UserTourProgressStorage.getSettings(pool, user.id_user);
      return { items: rows.map(normalizeProgressRow), settings: { hide_all_tours: !!settings?.hide_all_tours } };
    });
  }

  static async start(user, body = {}) {
    return this.#update(user, body, "in_progress");
  }

  static async complete(user, body = {}) {
    return this.#update(user, body, "completed");
  }

  static async skip(user, body = {}) {
    return this.#update(user, body, "skipped");
  }

  static async reset(user, body = {}) {
    return runWithLogs(log, "reset", () => ({ id_user: user?.id_user, tour_key: body?.tourKey }), async () => {
      if (!user?.id_user) return { error: "Usuário não autenticado" };
      const tourKey = typeof body?.tourKey === "string" ? body.tourKey.trim() : "";
      if (!ALLOWED_TOUR_KEYS.has(tourKey)) return { error: "tourKey inválido" };
      const row = await UserTourProgressStorage.resetTour(pool, { userId: user.id_user, tourKey });
      return { item: normalizeProgressRow(row) };
    });
  }

  static async #update(user, body, status) {
    return runWithLogs(log, "update", () => ({ id_user: user?.id_user, tour_key: body?.tourKey, status }), async () => {
      if (!user?.id_user) return { error: "Usuário não autenticado" };
      const tourKey = typeof body?.tourKey === "string" ? body.tourKey.trim() : "";
      if (!ALLOWED_TOUR_KEYS.has(tourKey)) return { error: "tourKey inválido" };
      if (!ALLOWED_STATUS.has(status)) return { error: "status inválido" };

      const parsedStep = Number.isFinite(Number(body?.currentStep)) ? Number(body.currentStep) : 0;
      const currentStep = Math.max(0, Math.floor(parsedStep));
      const row = await UserTourProgressStorage.upsertStatus(pool, {
        userId: user.id_user,
        tourKey,
        status,
        currentStep,
      });
      return { item: normalizeProgressRow(row) };
    });
  }

  static async updateSettings(user, body = {}) {
    return runWithLogs(log, "updateSettings", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Usuário não autenticado" };
      const hideAllTours = Boolean(body?.hideAllTours);
      const row = await UserTourProgressStorage.upsertSettings(pool, { userId: user.id_user, hideAllTours });
      return { settings: { hide_all_tours: !!row?.hide_all_tours } };
    });
  }
}

module.exports = UserTourProgressService;
