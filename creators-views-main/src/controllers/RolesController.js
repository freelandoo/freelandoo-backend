const RolesService = require("../services/RolesService");

class RolesController {
  static async list(req, res) {
    const data = await RolesService.list({ active: req.query.active });
    return res.json({ data });
  }

  static async getById(req, res) {
    const data = await RolesService.getById(req.params.id);
    return res.json({ data });
  }

  static async create(req, res) {
    const data = await RolesService.create({
      desc_role: req.body?.desc_role,
      created_by: req.user?.id_user || null,
    });
    return res.status(201).json({ data });
  }

  static async update(req, res) {
    const data = await RolesService.update({
      id_role: req.params.id,
      desc_role: req.body?.desc_role,
      is_active: req.body?.is_active,
      updated_by: req.user?.id_user || null,
    });
    return res.json({ data });
  }

  static async remove(req, res) {
    const data = await RolesService.remove({
      id_role: req.params.id,
      updated_by: req.user?.id_user || null,
    });
    return res.json({ data });
  }
}

module.exports = RolesController;
