/**
 * Cria Product + Price anual no Stripe e persiste os IDs em
 * public.tb_annual_fee_settings. Rode uma vez por ambiente.
 *
 * Uso:
 *   STRIPE_SECRET_KEY=sk_test_... \
 *   DATABASE_URL=postgres://... \
 *   node scripts/stripe-bootstrap.js
 */
require("dotenv").config();

const pool = require("../src/databases");
const StripeService = require("../src/services/StripeService");
const AnnualFeeSettingsStorage = require("../src/storages/AnnualFeeSettingsStorage");

async function main() {
  const settings = await AnnualFeeSettingsStorage.get(pool);
  if (!settings) {
    throw new Error(
      "tb_annual_fee_settings vazia — rode a migration 007 antes do bootstrap"
    );
  }

  if (settings.stripe_price_id && settings.stripe_product_id) {
    console.log("[bootstrap] já existe price/product:", {
      stripe_product_id: settings.stripe_product_id,
      stripe_price_id: settings.stripe_price_id,
    });
    console.log("[bootstrap] STRIPE_ANNUAL_PRICE_ID=" + settings.stripe_price_id);
    process.exit(0);
  }

  const { product, price } = await StripeService.createAnnualProductAndPrice({
    amount_cents: settings.amount_cents,
    currency: settings.currency,
  });

  await AnnualFeeSettingsStorage.setStripeIds(pool, {
    stripe_product_id: product.id,
    stripe_price_id: price.id,
  });

  console.log("[bootstrap] criado:", {
    product_id: product.id,
    price_id: price.id,
    amount_cents: settings.amount_cents,
    currency: settings.currency,
  });
  console.log("");
  console.log("Defina no Railway:");
  console.log("  STRIPE_ANNUAL_PRICE_ID=" + price.id);
}

main()
  .catch((err) => {
    console.error("[bootstrap] falhou:", err);
    process.exit(1);
  })
  .finally(() => pool.end().catch(() => {}));
