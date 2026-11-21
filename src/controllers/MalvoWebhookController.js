// src/controllers/MalvoWebhookController.js
//
// Webhook da Malvo (Open Finance, mig 462). `req.body` é um Buffer: a rota usa
// `express.raw()` porque o HMAC (`Malvo-Signature`) é sobre os BYTES CRUS.
const BankConnectionService = require("../services/BankConnectionService");

class MalvoWebhookController {
  static async receive(req, res) {
    const r = await BankConnectionService.handleWebhook(req.body, req.headers || {});
    return res.status(r.status).json(r.body);
  }
}

module.exports = MalvoWebhookController;
