const pool = require("../databases");
const MonetizationOnboardingStorage = require("../storages/MonetizationOnboardingStorage");
const TourPathStorage = require("../storages/TourPathStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("MonetizationOnboardingService");

const ALLOWED_DISMISS_REASONS = new Set(["later", "no_thanks", "closed"]);

function normalizeState(row) {
  if (!row) {
    return {
      dismissed: false,
      dismissed_at: null,
      dismissed_reason: null,
      selected_path_key: null,
      selected_at: null,
      active_tour_path_key: null,
    };
  }
  return {
    dismissed: !!row.dismissed_at,
    dismissed_at: row.dismissed_at,
    dismissed_reason: row.dismissed_reason,
    selected_path_key: row.selected_path_key,
    selected_at: row.selected_at,
    active_tour_path_key: row.active_tour_path_key,
  };
}

function normalizePath(row) {
  return {
    id: row.id,
    path_key: row.path_key,
    title: row.title,
    description: row.description,
    cta_label: row.cta_label,
    banner_image_url: row.banner_image_url,
    sort_order: row.sort_order,
    is_active: row.is_active,
    version: row.version,
  };
}

class MonetizationOnboardingService {
  static async getStatus(user) {
    return runWithLogs(log, "getStatus", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Usuário não autenticado" };
      const [state, paths] = await Promise.all([
        MonetizationOnboardingStorage.getState(pool, user.id_user),
        TourPathStorage.listPaths(pool, { onlyActive: true }),
      ]);
      return {
        state: normalizeState(state),
        paths: paths.map(normalizePath),
      };
    });
  }

  static async selectPath(user, body = {}) {
    return runWithLogs(log, "selectPath", () => ({ id_user: user?.id_user, path_key: body?.path_key }), async () => {
      if (!user?.id_user) return { error: "Usuário não autenticado" };
      const pathKey = typeof body?.path_key === "string" ? body.path_key.trim() : "";
      if (!pathKey || pathKey.length > 64) return { error: "path_key inválido" };

      const path = await TourPathStorage.getPathByKey(pool, pathKey);
      if (!path || !path.is_active) return { error: "Caminho indisponível" };

      const state = await MonetizationOnboardingStorage.selectPath(pool, user.id_user, pathKey);
      return { state: normalizeState(state) };
    });
  }

  static async dismiss(user, body = {}) {
    return runWithLogs(log, "dismiss", () => ({ id_user: user?.id_user, reason: body?.reason }), async () => {
      if (!user?.id_user) return { error: "Usuário não autenticado" };
      const raw = typeof body?.reason === "string" ? body.reason.trim() : "closed";
      const reason = ALLOWED_DISMISS_REASONS.has(raw) ? raw : "closed";
      const state = await MonetizationOnboardingStorage.dismiss(pool, user.id_user, reason);
      return { state: normalizeState(state) };
    });
  }
}

module.exports = MonetizationOnboardingService;
