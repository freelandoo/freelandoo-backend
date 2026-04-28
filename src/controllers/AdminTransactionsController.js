// src/controllers/AdminTransactionsController.js
const pool = require("../databases");
const AdminTransactionsStorage = require("../storages/AdminTransactionsStorage");

module.exports = {
  async listAll(req, res) {
    const transactions = await AdminTransactionsStorage.listAllTransactions(pool);
    return res.json(transactions);
  },
};
