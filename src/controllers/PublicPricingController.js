const pool = require("../databases");
const AnnualFeeSettingsStorage = require("../storages/AnnualFeeSettingsStorage");

class PublicPricingController {
  static async get(_req, res) {
    const settings = await AnnualFeeSettingsStorage.get(pool);
    const amount_cents = settings?.amount_cents ?? 30000;
    const currency = settings?.currency || "BRL";
    res.set("Cache-Control", "public, max-age=300");
    return res.json({
      subscription_annual: { amount_cents, currency },
    });
  }
}

module.exports = PublicPricingController;
