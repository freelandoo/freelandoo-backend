// src/controllers/AdminUsersController.js
const pool = require("../databases");
const AdminUsersStorage = require("../storages/AdminUsersStorage");

module.exports = {
  async listAll(req, res) {
    const users = await AdminUsersStorage.listAllUsers(pool);
    return res.json(users);
  },

  async setAdmin(req, res) {
    const { id } = req.params;
    const { is_admin } = req.body ?? {};

    if (typeof is_admin !== "boolean") {
      return res.status(400).json({ error: "Campo 'is_admin' é obrigatório (boolean)." });
    }
    if (req.user?.id_user === id) {
      return res.status(400).json({ error: "Você não pode alterar seu próprio status de administrador." });
    }

    const updated = await AdminUsersStorage.setAdmin(pool, id, is_admin);
    if (!updated) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }
    return res.json(updated);
  },
};
