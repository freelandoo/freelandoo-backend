const MachineService = require("../services/MachineService");

function handleError(res, err) {
  if (err instanceof MachineService.ServiceError) {
    return res.status(err.status).json({ error: err.message });
  }
  throw err;
}

class MachineController {
  static async listPublic(req, res) {
    try {
      const data = await MachineService.listPublicMachines();
      return res.json(data);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async listCategories(req, res) {
    try {
      const id_machine = Number(req.params.id_machine);
      if (!Number.isFinite(id_machine)) {
        return res.status(400).json({ error: "id_machine inválido" });
      }
      const data = await MachineService.listCategoriesOfMachine(id_machine);
      return res.json(data);
    } catch (err) {
      return handleError(res, err);
    }
  }
}

module.exports = MachineController;
