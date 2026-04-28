// src/controllers/AdminUsersController.js
const pool = require("../databases");
const AdminUsersStorage = require("../storages/AdminUsersStorage");

module.exports = {
  async listAll(req, res) {
    const users = await AdminUsersStorage.listAllUsers(pool);
    return res.json(users);
  },
};
