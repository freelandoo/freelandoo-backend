const pool = require("../databases");
const BookingFeeSettingsStorage = require("../storages/BookingFeeSettingsStorage");

class BookingFeeAdminController {
  static async get(req, res) {
    const settings = await BookingFeeSettingsStorage.get(pool);
    return res.json({ settings });
  }

  static async update(req, res) {
    const { stripe_fee_percent, service_fee_cents, is_active } = req.body || {};

    if (stripe_fee_percent != null) {
      const n = Number(stripe_fee_percent);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: "stripe_fee_percent deve ser entre 0 e 100" });
      }
    }
    if (service_fee_cents != null) {
      const n = Number(service_fee_cents);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: "service_fee_cents inválido" });
      }
    }

    const updated = await BookingFeeSettingsStorage.update(pool, {
      stripe_fee_percent: stripe_fee_percent != null ? Number(stripe_fee_percent) : null,
      service_fee_cents:  service_fee_cents  != null ? Math.round(Number(service_fee_cents)) : null,
      is_active: typeof is_active === "boolean" ? is_active : null,
      updated_by: req.user?.id_user || null,
    });
    return res.json({ settings: updated });
  }

  /** Rota pública — retorna apenas as taxas ativas para o frontend calcular preview. */
  static async getPublic(req, res) {
    const settings = await BookingFeeSettingsStorage.get(pool);
    if (!settings || !settings.is_active) {
      return res.json({ stripe_fee_percent: 0, service_fee_cents: 0 });
    }
    return res.json({
      stripe_fee_percent: Number(settings.stripe_fee_percent),
      service_fee_cents:  settings.service_fee_cents,
    });
  }
}

module.exports = BookingFeeAdminController;
