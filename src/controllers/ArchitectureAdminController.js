const ArchitectureService = require("../services/ArchitectureService");
const { sendServiceResult } = require("../utils/sendServiceResult");

function parseBool(v) {
  if (v === undefined || v === null || v === "") return undefined;
  if (v === "true" || v === "1" || v === true) return true;
  if (v === "false" || v === "0" || v === false) return false;
  return undefined;
}

class ArchitectureAdminController {
  static async summary(req, res) {
    return sendServiceResult(res, await ArchitectureService.summary());
  }

  static async listFunctions(req, res) {
    const q = req.query || {};
    return sendServiceResult(res, await ArchitectureService.listFunctions({
      status: q.status || undefined,
      kind: q.kind || undefined,
      repo: q.repo || undefined,
      area: q.area || undefined,
      committed: parseBool(q.committed),
      pushed: parseBool(q.pushed),
      archived: parseBool(q.archived),
      q: q.q || undefined,
      sort: q.sort || "area",
      order: q.order || "asc",
      page: q.page,
      perPage: q.per_page,
    }));
  }

  static async getFunction(req, res) {
    return sendServiceResult(res, await ArchitectureService.getFunction(req.params.id));
  }

  static async updateFunction(req, res) {
    const userId = req.user?.id_user;
    return sendServiceResult(res, await ArchitectureService.updateCuration(req.params.id, req.body || {}, userId));
  }

  static async sync(req, res) {
    return sendServiceResult(res, await ArchitectureService.sync());
  }

  static async listLogs(req, res) {
    const q = req.query || {};
    return sendServiceResult(res, await ArchitectureService.listLogs({
      path: q.path || undefined,
      method: q.method || undefined,
      status: q.status || undefined,
      minStatus: q.min_status || undefined,
      errorsOnly: parseBool(q.errors_only) === true,
      since: q.since || undefined,
      page: q.page,
      perPage: q.per_page,
    }));
  }

  static async logsSummary(req, res) {
    const hours = Math.min(Math.max(Number(req.query?.hours) || 24, 1), 720);
    return sendServiceResult(res, await ArchitectureService.logsSummary(hours));
  }

  static async purgeLogs(req, res) {
    return sendServiceResult(res, await ArchitectureService.purgeLogs(req.query?.older_than_days));
  }
}

module.exports = ArchitectureAdminController;
