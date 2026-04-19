const MachineService = require("../services/MachineService");

function handleError(res, err) {
  if (err instanceof MachineService.ServiceError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err && typeof err.status === "number") {
    return res.status(err.status).json({ error: err.message || "Erro" });
  }
  throw err;
}

class MachineAdminController {
  static async listAll(req, res) {
    try {
      const data = await MachineService.listAllMachines();
      return res.json(data);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async updateStatus(req, res) {
    try {
      const id_machine = Number(req.params.id_machine);
      if (!Number.isFinite(id_machine)) {
        return res.status(400).json({ error: "id_machine inválido" });
      }
      const { is_active, reason } = req.body || {};
      const row = await MachineService.setMachineStatus(req.user, id_machine, {
        is_active,
        reason,
      });
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async update(req, res) {
    try {
      const id_machine = Number(req.params.id_machine);
      if (!Number.isFinite(id_machine)) {
        return res.status(400).json({ error: "id_machine inválido" });
      }
      const row = await MachineService.updateMachine(req.user, id_machine, req.body || {});
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async addCategory(req, res) {
    try {
      const id_machine = Number(req.params.id_machine);
      if (!Number.isFinite(id_machine)) {
        return res.status(400).json({ error: "id_machine inválido" });
      }
      const row = await MachineService.addCategory(req.user, id_machine, req.body || {});
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
      const row = await MachineService.updateCategory(req.user, id_category, req.body || {});
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }
}

module.exports = MachineAdminController;
