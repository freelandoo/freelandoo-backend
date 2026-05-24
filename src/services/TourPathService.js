const pool = require("../databases");
const TourPathStorage = require("../storages/TourPathStorage");
const MonetizationOnboardingStorage = require("../storages/MonetizationOnboardingStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("TourPathService");

const STATUS_TRANSITIONS = {
  start: "in_progress",
  progress: "in_progress",
  complete: "completed",
  skip: "skipped",
};

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

function normalizeStep(row) {
  return {
    id: row.id,
    step_order: row.step_order,
    route: row.route,
    target_selector: row.target_selector,
    wait_for_selector: row.wait_for_selector,
    placement: row.placement,
    title: row.title,
    content: row.content,
    on_enter_action: row.on_enter_action,
    on_leave_action: row.on_leave_action,
  };
}

function normalizeProgress(row) {
  if (!row) {
    return {
      status: "not_started",
      current_step: 0,
      path_version: 1,
      started_at: null,
      completed_at: null,
      skipped_at: null,
    };
  }
  return {
    status: row.status,
    current_step: row.current_step,
    path_version: row.path_version,
    started_at: row.started_at,
    completed_at: row.completed_at,
    skipped_at: row.skipped_at,
  };
}

class TourPathService {
  static async listActive(_user) {
    return runWithLogs(log, "listActive", () => ({}), async () => {
      const rows = await TourPathStorage.listPaths(pool, { onlyActive: true });
      return { items: rows.map(normalizePath) };
    });
  }

  static async getByKey(user, pathKey) {
    return runWithLogs(log, "getByKey", () => ({ id_user: user?.id_user, path_key: pathKey }), async () => {
      const key = typeof pathKey === "string" ? pathKey.trim() : "";
      if (!key || key.length > 64) return { error: "path_key inválido" };

      const path = await TourPathStorage.getPathByKey(pool, key);
      if (!path || !path.is_active) return { error: "Caminho indisponível" };

      const steps = await TourPathStorage.listStepsByPath(pool, path.id);
      const progress = user?.id_user
        ? await TourPathStorage.getProgress(pool, user.id_user, key)
        : null;

      return {
        path: normalizePath(path),
        steps: steps.map(normalizeStep),
        progress: normalizeProgress(progress),
      };
    });
  }

  static async transition(user, pathKey, transition, body = {}) {
    return runWithLogs(log, "transition", () => ({
      id_user: user?.id_user,
      path_key: pathKey,
      transition,
    }), async () => {
      if (!user?.id_user) return { error: "Usuário não autenticado" };
      const key = typeof pathKey === "string" ? pathKey.trim() : "";
      if (!key || key.length > 64) return { error: "path_key inválido" };

      const status = STATUS_TRANSITIONS[transition];
      if (!status) return { error: "transição inválida" };

      const path = await TourPathStorage.getPathByKey(pool, key);
      if (!path || !path.is_active) return { error: "Caminho indisponível" };

      const totalSteps = await TourPathStorage.listStepsByPath(pool, path.id);
      const maxStep = Math.max(0, totalSteps.length - 1);

      let currentStep = 0;
      if (transition === "start") {
        currentStep = 0;
      } else if (transition === "progress") {
        const parsed = Number.isFinite(Number(body?.current_step)) ? Number(body.current_step) : 0;
        currentStep = Math.max(0, Math.min(maxStep, Math.floor(parsed)));
      } else if (transition === "complete") {
        currentStep = maxStep;
      } else if (transition === "skip") {
        const existing = await TourPathStorage.getProgress(pool, user.id_user, key);
        currentStep = existing?.current_step ?? 0;
      }

      const row = await TourPathStorage.upsertProgress(pool, {
        userId: user.id_user,
        pathKey: key,
        status,
        currentStep,
        pathVersion: path.version,
      });

      if (transition === "complete" || transition === "skip") {
        await MonetizationOnboardingStorage.clearActiveTour(pool, user.id_user);
      }

      return { progress: normalizeProgress(row) };
    });
  }
}

module.exports = TourPathService;
