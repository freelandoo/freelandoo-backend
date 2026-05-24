const pool = require("../databases");
const TourPathStorage = require("../storages/TourPathStorage");
const uploadTourCardToR2 = require("../integrations/r2/uploadTourCard");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("AdminTourPathService");

const ALLOWED_PLACEMENTS = new Set(["top", "bottom", "left", "right", "center"]);
const PATH_KEY_RX = /^[a-z0-9_-]{2,64}$/;

function clean(str, max = 500) {
  if (typeof str !== "string") return null;
  const trimmed = str.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function normalizePath(row) {
  return {
    id: row.id,
    path_key: row.path_key,
    title: row.title,
    description: row.description,
    cta_label: row.cta_label,
    banner_image_url: row.banner_image_url,
    banner_object_key: row.banner_object_key,
    sort_order: row.sort_order,
    is_active: row.is_active,
    is_seed: row.is_seed,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeStep(row) {
  return {
    id: row.id,
    path_id: row.path_id,
    step_order: row.step_order,
    route: row.route,
    target_selector: row.target_selector,
    wait_for_selector: row.wait_for_selector,
    placement: row.placement,
    title: row.title,
    content: row.content,
    on_enter_action: row.on_enter_action,
    on_leave_action: row.on_leave_action,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

class AdminTourPathService {
  // ---------- Paths ----------

  static async listPaths() {
    return runWithLogs(log, "listPaths", () => ({}), async () => {
      const rows = await TourPathStorage.listPaths(pool, { onlyActive: false });
      return { items: rows.map(normalizePath) };
    });
  }

  static async getPath(id) {
    return runWithLogs(log, "getPath", () => ({ id }), async () => {
      const row = await TourPathStorage.getPathById(pool, id);
      if (!row) return { error: "Caminho não encontrado" };
      return { path: normalizePath(row) };
    });
  }

  static async createPath(body = {}, file = null) {
    return runWithLogs(log, "createPath", () => ({ path_key: body?.path_key }), async () => {
      const path_key = clean(body.path_key, 64);
      const title = clean(body.title, 120);
      const description = clean(body.description, 500);
      const cta_label = clean(body.cta_label, 60) || "Começar";

      if (!path_key || !PATH_KEY_RX.test(path_key)) return { error: "path_key inválido" };
      if (!title) return { error: "title obrigatório" };
      if (!description) return { error: "description obrigatória" };

      const existing = await TourPathStorage.getPathByKey(pool, path_key);
      if (existing) return { error: "path_key já existe" };

      let banner_image_url = null;
      let banner_object_key = null;
      if (file?.buffer) {
        const uploaded = await uploadTourCardToR2({ file, kind: path_key });
        banner_image_url = uploaded.url;
        banner_object_key = uploaded.objectKey;
      }

      const row = await TourPathStorage.createPath(pool, {
        path_key,
        title,
        description,
        cta_label,
        banner_image_url,
        banner_object_key,
        sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
        is_active: body.is_active === false ? false : true,
      });
      return { path: normalizePath(row) };
    });
  }

  static async updatePath(id, body = {}, file = null) {
    return runWithLogs(log, "updatePath", () => ({ id }), async () => {
      const existing = await TourPathStorage.getPathById(pool, id);
      if (!existing) return { error: "Caminho não encontrado" };

      const patch = {};

      // path_key não pode mudar em seed (quebra acoplamento com user state)
      if (body.path_key !== undefined && !existing.is_seed) {
        const next = clean(body.path_key, 64);
        if (!next || !PATH_KEY_RX.test(next)) return { error: "path_key inválido" };
        if (next !== existing.path_key) {
          const dup = await TourPathStorage.getPathByKey(pool, next);
          if (dup) return { error: "path_key já existe" };
        }
        patch.path_key = next;
      }
      if (body.title !== undefined) {
        const v = clean(body.title, 120);
        if (!v) return { error: "title obrigatório" };
        patch.title = v;
      }
      if (body.description !== undefined) {
        const v = clean(body.description, 500);
        if (!v) return { error: "description obrigatória" };
        patch.description = v;
      }
      if (body.cta_label !== undefined) patch.cta_label = clean(body.cta_label, 60) || "Começar";
      if (body.sort_order !== undefined && Number.isFinite(Number(body.sort_order))) {
        patch.sort_order = Number(body.sort_order);
      }
      if (body.is_active !== undefined) patch.is_active = !!body.is_active;

      if (file?.buffer) {
        const uploaded = await uploadTourCardToR2({ file, kind: existing.path_key });
        patch.banner_image_url = uploaded.url;
        patch.banner_object_key = uploaded.objectKey;
      }

      const row = await TourPathStorage.updatePath(pool, id, patch);
      return { path: normalizePath(row) };
    });
  }

  static async deletePath(id) {
    return runWithLogs(log, "deletePath", () => ({ id }), async () => {
      const existing = await TourPathStorage.getPathById(pool, id);
      if (!existing) return { error: "Caminho não encontrado" };
      if (existing.is_seed) return { error: "Caminhos fixos não podem ser deletados — desative em vez disso." };
      const ok = await TourPathStorage.deletePath(pool, id);
      if (!ok) return { error: "Falha ao deletar" };
      return { deleted: true };
    });
  }

  static async uploadBanner(file) {
    return runWithLogs(log, "uploadBanner", () => ({ name: file?.originalname }), async () => {
      if (!file?.buffer) return { error: "Arquivo obrigatório" };
      const { url, objectKey } = await uploadTourCardToR2({ file, kind: "standalone" });
      return { url, object_key: objectKey };
    });
  }

  // ---------- Steps ----------

  static async listSteps(pathId) {
    return runWithLogs(log, "listSteps", () => ({ path_id: pathId }), async () => {
      const path = await TourPathStorage.getPathById(pool, pathId);
      if (!path) return { error: "Caminho não encontrado" };
      const rows = await TourPathStorage.listStepsByPath(pool, pathId);
      return { items: rows.map(normalizeStep) };
    });
  }

  static async createStep(body = {}) {
    return runWithLogs(log, "createStep", () => ({ path_id: body?.path_id }), async () => {
      const path_id = clean(body.path_id, 64);
      if (!path_id) return { error: "path_id obrigatório" };
      const path = await TourPathStorage.getPathById(pool, path_id);
      if (!path) return { error: "Caminho não encontrado" };

      const route = clean(body.route, 200);
      const title = clean(body.title, 120);
      const content = clean(body.content, 500);
      if (!route) return { error: "route obrigatória" };
      if (!title) return { error: "title obrigatório" };
      if (!content) return { error: "content obrigatório" };

      const placement = clean(body.placement, 16) || "bottom";
      if (!ALLOWED_PLACEMENTS.has(placement)) return { error: "placement inválido" };

      const step_order = Number.isFinite(Number(body.step_order))
        ? Math.max(0, Math.floor(Number(body.step_order)))
        : 0;

      const row = await TourPathStorage.createStep(pool, {
        path_id,
        step_order,
        route,
        target_selector: clean(body.target_selector, 200),
        wait_for_selector: clean(body.wait_for_selector, 200),
        placement,
        title,
        content,
        on_enter_action: clean(body.on_enter_action, 60),
        on_leave_action: clean(body.on_leave_action, 60),
      });

      await TourPathStorage.bumpVersion(pool, path_id);
      return { step: normalizeStep(row) };
    });
  }

  static async updateStep(id, body = {}) {
    return runWithLogs(log, "updateStep", () => ({ id }), async () => {
      const existing = await TourPathStorage.getStepById(pool, id);
      if (!existing) return { error: "Passo não encontrado" };

      const patch = {};
      if (body.step_order !== undefined && Number.isFinite(Number(body.step_order))) {
        patch.step_order = Math.max(0, Math.floor(Number(body.step_order)));
      }
      if (body.route !== undefined) {
        const v = clean(body.route, 200);
        if (!v) return { error: "route obrigatória" };
        patch.route = v;
      }
      if (body.target_selector !== undefined) patch.target_selector = clean(body.target_selector, 200);
      if (body.wait_for_selector !== undefined) patch.wait_for_selector = clean(body.wait_for_selector, 200);
      if (body.placement !== undefined) {
        const v = clean(body.placement, 16) || "bottom";
        if (!ALLOWED_PLACEMENTS.has(v)) return { error: "placement inválido" };
        patch.placement = v;
      }
      if (body.title !== undefined) {
        const v = clean(body.title, 120);
        if (!v) return { error: "title obrigatório" };
        patch.title = v;
      }
      if (body.content !== undefined) {
        const v = clean(body.content, 500);
        if (!v) return { error: "content obrigatório" };
        patch.content = v;
      }
      if (body.on_enter_action !== undefined) patch.on_enter_action = clean(body.on_enter_action, 60);
      if (body.on_leave_action !== undefined) patch.on_leave_action = clean(body.on_leave_action, 60);

      const row = await TourPathStorage.updateStep(pool, id, patch);
      await TourPathStorage.bumpVersion(pool, existing.path_id);
      return { step: normalizeStep(row) };
    });
  }

  static async deleteStep(id) {
    return runWithLogs(log, "deleteStep", () => ({ id }), async () => {
      const existing = await TourPathStorage.getStepById(pool, id);
      if (!existing) return { error: "Passo não encontrado" };
      const ok = await TourPathStorage.deleteStep(pool, id);
      if (!ok) return { error: "Falha ao deletar" };
      await TourPathStorage.bumpVersion(pool, existing.path_id);
      return { deleted: true };
    });
  }
}

module.exports = AdminTourPathService;
