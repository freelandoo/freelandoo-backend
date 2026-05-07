require("dotenv").config();

const pool = require("../src/databases");
const StripeService = require("../src/services/StripeService");
const AffiliateConversionService = require("../src/services/AffiliateConversionService");

function hasArg(name) {
  return process.argv.includes(name);
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

async function loadSession(row) {
  if (row.raw_event && row.raw_event.object === "checkout.session") {
    return row.raw_event;
  }
  if (!row.stripe_checkout_session_id) return row.raw_event || null;
  try {
    return await StripeService.retrieveSession(row.stripe_checkout_session_id);
  } catch (error) {
    console.warn(
      `[warn] could not retrieve Stripe session ${row.stripe_checkout_session_id}: ${error.message}`
    );
    return row.raw_event || null;
  }
}

async function main() {
  const couponCode = getArgValue("--coupon");
  const dryRun = hasArg("--dry-run");
  const values = [];
  const where = [
    "ps.id_coupon IS NOT NULL",
    "(ps.status IN ('active', 'past_due') OR ps.paid_at IS NOT NULL)",
  ];

  if (couponCode) {
    values.push(couponCode);
    where.push(`UPPER(c.code) = UPPER($${values.length})`);
  }

  const { rows } = await pool.query(
    `
    SELECT
      ps.*,
      c.code AS coupon_code,
      o.id_order,
      ac.id_conversion
    FROM public.tb_profile_subscription ps
    INNER JOIN public.tb_coupon c ON c.id_coupon = ps.id_coupon
    LEFT JOIN public.tb_order o
      ON o.payment_provider = 'stripe'
     AND o.payment_provider_ref = ps.stripe_checkout_session_id
    LEFT JOIN public.tb_affiliate_conversion ac ON ac.id_order = o.id_order
    WHERE ${where.join(" AND ")}
    ORDER BY ps.created_at ASC
    `,
    values
  );

  const pending = rows.filter((row) => !row.id_conversion);
  console.log(
    `[info] subscriptions_with_coupon=${rows.length} missing_conversion=${pending.length}`
  );

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of pending) {
    if (dryRun) {
      console.log(
        `[dry-run] would backfill subscription=${row.id_subscription} coupon=${row.coupon_code}`
      );
      continue;
    }

    const session = await loadSession(row);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const conversion =
        await AffiliateConversionService.createFromProfileSubscription(client, {
          subscription: row,
          session,
        });
      await client.query("COMMIT");

      if (conversion) {
        created += 1;
        console.log(
          `[ok] subscription=${row.id_subscription} conversion=${conversion.id_conversion}`
        );
      } else {
        skipped += 1;
        console.log(`[skip] subscription=${row.id_subscription}`);
      }
    } catch (error) {
      await client.query("ROLLBACK");
      failed += 1;
      console.error(
        `[fail] subscription=${row.id_subscription} coupon=${row.coupon_code}: ${error.message}`
      );
    } finally {
      client.release();
    }
  }

  console.log(`[done] created=${created} skipped=${skipped} failed=${failed}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
