// test/asaas-provider-truth.e2e.js
//
// Exercita a mig 237: os dois CHECKs que ainda não conheciam o Asaas.
//
// ⚠️ ESTA SUÍTE PODE APONTAR PARA PRODUÇÃO porque NÃO EXISTE UM `COMMIT` NELA.
// Tudo roda dentro de uma transação que termina em ROLLBACK, e no fim ela
// confere que produção ficou intocada. Não acrescente COMMIT aqui.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/databases");

let pass = 0;
let fail = 0;

function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.error("  FAIL " + label + (extra !== undefined ? " :: " + JSON.stringify(extra) : "")); }
}

let sp = 0;
/** SAVEPOINT: constraint violada ABORTA a transação inteira e cegaria os testes seguintes. */
async function violates(client, sql, params, constraintName) {
  const name = "sp_" + ++sp;
  await client.query(`SAVEPOINT ${name}`);
  try {
    await client.query(sql, params);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: false, reason: "não levantou erro" };
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    // ⚠️ Conferir pelo NOME da constraint: um erro qualquer (NOT NULL, FK)
    // faria o teste passar como se a regra certa estivesse de pé.
    const hit = String(e.constraint || "") === constraintName;
    return { ok: hit, reason: e.constraint || e.message };
  }
}

async function checksOn(client, table, column) {
  const r = await client.query(
    `SELECT con.conname, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con
       JOIN pg_class cls ON cls.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = cls.relnamespace
      WHERE ns.nspname='public' AND cls.relname=$1 AND con.contype='c'
        AND pg_get_constraintdef(con.oid) ILIKE '%' || $2 || '%'`,
    [table, column]
  );
  return r.rows;
}

async function main() {
  if (!(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL)) {
    console.error("Defina DATABASE_URL ou TEST_DATABASE_URL");
    process.exit(1);
  }
  const client = await pool.connect();
  const mig = fs.readFileSync(
    path.join(__dirname, "..", "src", "databases", "migrations", "237_asaas_provider_truth.sql"),
    "utf8"
  );

  console.log("\n== mig 237: os CHECKs aprendem o Asaas ==");
  await client.query("BEGIN");
  try {
    await client.query(mig);
    check("migration aplica", true);
    // O runner reaplica no boot de todo deploy.
    await client.query(mig);
    check("2ª aplicação não quebra (idempotente)", true);

    // ── 1. vaga de anúncio de condomínio ──────────────────────────────────
    const slotChecks = await checksOn(client, "tb_condo_listing_slot", "payment_provider");
    check("existe EXATAMENTE UM check de payment_provider", slotChecks.length === 1,
      slotChecks.map((r) => r.conname));
    const slotDef = slotChecks[0] ? slotChecks[0].def : "";
    check("o check aceita 'asaas'", /asaas/i.test(slotDef), slotDef);
    for (const v of ["stripe", "polens", "admin_grant"]) {
      check(`o check preserva '${v}'`, new RegExp(`'${v}'`).test(slotDef), slotDef);
    }

    // ── 2. taxa da Loja ───────────────────────────────────────────────────
    const feeChecks = await checksOn(client, "tb_profile_product_order", "processor_fee_source");
    check("existe EXATAMENTE UM check de processor_fee_source", feeChecks.length === 1,
      feeChecks.map((r) => r.conname));
    const feeDef = feeChecks[0] ? feeChecks[0].def : "";
    check("o check aceita 'asaas_fee'", /asaas_fee/i.test(feeDef), feeDef);
    for (const v of ["fallback", "stripe_balance_tx", "manual"]) {
      check(`o check preserva '${v}'`, new RegExp(`'${v}'`).test(feeDef), feeDef);
    }
    check("a constraint manteve o nome explícito da mig 074",
      feeChecks[0] && feeChecks[0].conname === "tb_profile_product_order_processor_src_chk",
      feeChecks[0] && feeChecks[0].conname);

    // ── 3. o CHECK exercitado DE VERDADE, sobre linha existente ────────────
    const anyOrder = await client.query(
      `SELECT id_order FROM public.tb_profile_product_order LIMIT 1`
    );
    if (anyOrder.rowCount === 1) {
      const id = anyOrder.rows[0].id_order;
      await client.query(
        `UPDATE public.tb_profile_product_order SET processor_fee_source='asaas_fee' WHERE id_order=$1`,
        [id]
      );
      check("UPDATE para 'asaas_fee' é ACEITO", true);
      const bad = await violates(
        client,
        `UPDATE public.tb_profile_product_order SET processor_fee_source='inventado' WHERE id_order=$1`,
        [id],
        "tb_profile_product_order_processor_src_chk"
      );
      check("valor inventado é recusado PELO NOME da constraint", bad.ok, bad.reason);
    } else {
      console.log("  --   (sem pedido em produção: CHECK conferido só pelo catálogo)");
    }

    const anySlot = await client.query(`SELECT id_slot FROM public.tb_condo_listing_slot LIMIT 1`);
    if (anySlot.rowCount === 1) {
      const id = anySlot.rows[0].id_slot;
      await client.query(
        `UPDATE public.tb_condo_listing_slot SET payment_provider='asaas' WHERE id_slot=$1`, [id]
      );
      check("UPDATE da vaga para 'asaas' é ACEITO", true);
      const bad = await violates(
        client,
        `UPDATE public.tb_condo_listing_slot SET payment_provider='inventado' WHERE id_slot=$1`,
        [id],
        "tb_condo_listing_slot_provider_chk"
      );
      check("provedor inventado é recusado PELO NOME da constraint", bad.ok, bad.reason);
    } else {
      console.log("  --   (sem vaga em produção: CHECK conferido só pelo catálogo)");
    }

    // ── 4. o radar da mig 074 continua de pé ──────────────────────────────
    const idx = await client.query(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename='tb_profile_product_order' AND indexname='idx_pp_order_processor_pending'`
    );
    check("o índice parcial que varre quem ficou em 'fallback' sobreviveu", idx.rowCount === 1);
  } finally {
    await client.query("ROLLBACK");
  }

  console.log("\n== produção intocada depois do rollback ==");
  const slotAfter = await checksOn(client, "tb_condo_listing_slot", "payment_provider");
  const feeAfter = await checksOn(client, "tb_profile_product_order", "processor_fee_source");
  check("o check da vaga NÃO conhece 'asaas' em produção (rollback)",
    slotAfter.length === 1 && !/asaas/i.test(slotAfter[0].def), slotAfter.map((r) => r.def));
  check("o check da taxa NÃO conhece 'asaas_fee' em produção (rollback)",
    feeAfter.length === 1 && !/asaas_fee/i.test(feeAfter[0].def), feeAfter.map((r) => r.def));
  const sujo = await client.query(
    `SELECT COUNT(*)::int AS n FROM public.tb_profile_product_order WHERE processor_fee_source='asaas_fee'`
  );
  check("nenhuma linha de teste sobrou", sujo.rows[0].n === 0, sujo.rows[0]);

  client.release();
  await pool.end();
  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
