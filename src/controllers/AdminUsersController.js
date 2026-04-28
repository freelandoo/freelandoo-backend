// src/controllers/AdminUsersController.js
const db = require("../databases/connection");
const AdminUsersStorage = require("../storages/AdminUsersStorage");

module.exports = {
  async listAll(req, res) {
    const users = await AdminUsersStorage.listAllUsers(db);
    return res.json(users);
  },
};
