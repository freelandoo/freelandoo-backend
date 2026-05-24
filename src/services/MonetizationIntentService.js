const pool = require("../databases");
const MonetizationIntentStorage = require("../storages/MonetizationIntentStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("MonetizationIntentService");
const ALLOWED_DISMISS = new Set(["later", "no_thanks", "closed"]);

function normalizeState(row) {
  if (!row) {
    return { dismissed: false, selected_path_key: null };
  }
  return {
    dismissed: !!row.dismissed_at,
    dismissed_at: row.dismissed_at,
    selected_path_key: row.selected_path_key,
    selected_at: row.selected_at,
  };
}

function normalizePath(row) {
  return {
    id: row.id,
    path_key: row.path_key,
    title: row.title,
    description: row.description,
    cta_label: row.cta_label,
    accent_color: row.accent_color || "amber",
    video_url: row.video_url,
    poster_url: row.poster_url,
    banner_image_url: row.banner_image_url,
    sort_order: row.sort_order,
  };
}

class MonetizationIntentService {
  static async getStatus(user) {
    return runWithLogs(log, "getStatus", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Usuário não autenticado" };
      const [state, paths] = await Promise.all([
        MonetizationIntentStorage.getState(pool, user.id_user),
        MonetizationIntentStorage.listActivePaths(pool),
      ]);
      return {
        state: normalizeState(state),
        paths: paths.map(normalizePath),
      };
    });
  }

  static async choose(user, body = {}) {
    return runWithLogs(log, "choose", () => ({ id_user: user?.id_user, path_key: body?.path_key }), async () => {
      if (!user?.id_user) return { error: "Usuário não autenticado" };
      const pathKey = typeof body?.path_key === "string" ? body.path_key.trim() : "";
      if (!pathKey || pathKey.length > 64) return { error: "path_key inválido" };

      const path = await MonetizationIntentStorage.getPathByKey(pool, pathKey);
      if (!path) return { error: "Caminho indisponível" };

      const state = await MonetizationIntentStorage.choose(pool, user.id_user, pathKey);
      return {
        state: normalizeState(state),
        path: {
          path_key: path.path_key,
          title: path.title,
          video_url: path.video_url,
          poster_url: path.poster_url,
        },
      };
    });
  }

  static async dismiss(user, body = {}) {
    return runWithLogs(log, "dismiss", () => ({ id_user: user?.id_user, reason: body?.reason }), async () => {
      if (!user?.id_user) return { error: "Usuário não autenticado" };
      const raw = typeof body?.reason === "string" ? body.reason.trim() : "closed";
      const reason = ALLOWED_DISMISS.has(raw) ? raw : "closed";
      const state = await MonetizationIntentStorage.dismiss(pool, user.id_user, reason);
      return { state: normalizeState(state) };
    });
  }
}

module.exports = MonetizationIntentService;
