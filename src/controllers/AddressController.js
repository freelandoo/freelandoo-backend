const pool = require("../databases");

class AddressController {
  static async getEstados(req, res) {
    const result = await pool.query(
      "SELECT id, nome, uf FROM estado ORDER BY nome"
    );
    return res.status(200).json(result.rows);
  }
}

module.exports = AddressController;
