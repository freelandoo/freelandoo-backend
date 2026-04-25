const pool = require("../databases");
const AnnualFeeSettingsStorage = require("../storages/AnnualFeeSettingsStorage");

class AnnualFeeAdminController {
  static async get(req, res) {
    const settings = await AnnualFeeSettingsStorage.get(pool);
    return res.json({ settings });
  }

  static async update(req, res) {
    const { amount_cents, currency, is_active } = req.body || {};
    if (amount_cents != null) {
      const n = Number(amount_cents);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: "amount_cents inválido" });
      }
    }
    const updated = await AnnualFeeSettingsStorage.update(pool, {
      amount_cents: amount_cents != null ? Number(amount_cents) : null,
      currency: currency || null,
      is_active: typeof is_active === "boolean" ? is_active : null,
      updated_by: req.user?.id_user || null,
    });
    return res.json({ settings: updated });
  }
}

module.exports = AnnualFeeAdminController;
