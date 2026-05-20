const EnxameService = require("../services/EnxameService");

function handleError(res, err) {
  if (err instanceof EnxameService.ServiceError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err && typeof err.status === "number") {
    return res.status(err.status).json({ error: err.message || "Erro" });
  }
  throw err;
}

class EnxameAdminController {
  static async listAll(req, res) {
    try {
      const data = await EnxameService.listAllEnxames();
      return res.json(data);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async updateStatus(req, res) {
    try {
      const id_enxame = Number(req.params.id_enxame);
      if (!Number.isFinite(id_enxame)) {
        return res.status(400).json({ error: "id_enxame inválido" });
      }
      const { is_active, reason } = req.body || {};
      const row = await EnxameService.setEnxameStatus(req.user, id_enxame, {
        is_active,
        reason,
      });
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async create(req, res) {
    try {
      const row = await EnxameService.createEnxame(req.user, req.body || {});
      return res.status(201).json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async remove(req, res) {
    try {
      const id_enxame = Number(req.params.id_enxame);
      if (!Number.isFinite(id_enxame)) {
        return res.status(400).json({ error: "id_enxame inválido" });
      }
      const row = await EnxameService.deleteEnxame(req.user, id_enxame, {
        reason: req.body?.reason,
      });
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async update(req, res) {
    try {
      const id_enxame = Number(req.params.id_enxame);
      if (!Number.isFinite(id_enxame)) {
        return res.status(400).json({ error: "id_enxame inválido" });
      }
      const row = await EnxameService.updateEnxame(req.user, id_enxame, req.body || {});
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async addCategory(req, res) {
    try {
      const id_enxame = Number(req.params.id_enxame);
      if (!Number.isFinite(id_enxame)) {
        return res.status(400).json({ error: "id_enxame inválido" });
      }
      const row = await EnxameService.addCategory(req.user, id_enxame, req.body || {});
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async updateCategory(req, res) {
    try {
      const id_category = Number(req.params.id_category);
      if (!Number.isFinite(id_category)) {
        return res.status(400).json({ error: "id_category inválido" });
      }
      const row = await EnxameService.updateCategory(req.user, id_category, req.body || {});
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }
}

module.exports = EnxameAdminController;
