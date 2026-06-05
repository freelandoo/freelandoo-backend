// src/controllers/AdminTransactionsController.js
const pool = require("../databases");
const AdminTransactionsStorage = require("../storages/AdminTransactionsStorage");

const TIPOS = [
  "assinatura",
  "taxa_agenda",
  "comissao_loja",
  "venda_polens",
  "premium",
  "manifestacao",
];

function parseFilters(query) {
  const tipo = TIPOS.includes(query.tipo) ? query.tipo : null;
  const from = query.from ? String(query.from) : null;
  const to = query.to ? String(query.to) : null;
  return { tipo, from, to };
}

module.exports = {
  // Mantém compatibilidade: retorna o array de transações (com filtros opcionais
  // ?tipo=&from=&to=). Totais são calculados no front sobre o conjunto filtrado.
  async listAll(req, res) {
    const filters = parseFilters(req.query);
    const transactions = await AdminTransactionsStorage.listAllTransactions(pool, filters);
    return res.json(transactions);
  },
};
