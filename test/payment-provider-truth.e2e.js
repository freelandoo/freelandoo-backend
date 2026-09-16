// test/payment-provider-truth.e2e.js
//
// Exercita a mig 250: os CINCO CHECKs que ainda não conheciam o Mercado Pago.
//
// ⚠️ ESTA SUÍTE PODE APONTAR PARA PRODUÇÃO porque NÃO EXISTE UM `COMMIT` NELA.
// Tudo roda dentro de uma transação que termina em ROLLBACK, e no fim ela
// confere que produção voltou ao estado em que estava. Não acrescente COMMIT.
//
// ─── ⚠️ POR QUE ELA MEDE O ESTADO *ANTES* ───────────────────────────────────
//
// A suíte anterior (`asaas-provider-truth`) terminava exigindo que produção
// "NÃO conhecesse 'asaas'" depois do rollback. Isso era verdade no dia em que
// foi escrita e deixou de ser no dia em que a mig 237 subiu — a asserção passou
// a acusar como defeito exatamente o deploy funcionando.
//
// Asserção sobre "o banco não tem X" nasce com prazo de validade quando X é uma
// migration que vai subir. Aqui a pergunta é outra e não envelhece: o estado
// depois do ROLLBACK é IDÊNTICO ao de antes do BEGIN.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/databases");

let pass = 0;
let fail = 0;

function check(label, cond, extra) {
  if (typeof cond !== "boolean") {
    fail++;
    console.error(`  FAIL ${label} :: condição não é booleana (${typeof cond})`);
    return;
  }
  if (cond) {
    pass++;
    console.log("  ok   " + label);
  } else {
    fail++;
    console.error("  FAIL " + label + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));
  }
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
    // ⚠️ Conferir pelo NOME da constraint: um erro qualquer (NOT NULL, FK, ou
    // um truncamento de VARCHAR) faria o teste passar como se a regra certa
    // estivesse de pé.
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

/** As colunas cujo CHECK a mig 250 alarga, e o que cada um tem que preservar. */
const TARGETS = [
  {
    table: "tb_payment_intent",
    column: "provider",
    constraint: "tb_payment_intent_provider_check",
    accepts: "mercadopago",
    preserves: ["stripe", "asaas"],
  },
  {
    table: "tb_stripe_webhook_event",
    column: "provider",
    constraint: "tb_stripe_webhook_event_provider_check",
    accepts: "mercadopago",
    preserves: ["stripe", "asaas"],
  },
  {
    table: "tb_condo_listing_slot",
    column: "payment_provider",
    constraint: "tb_condo_listing_slot_provider_chk",
    accepts: "mercadopago",
    preserves: ["stripe", "asaas", "polens", "admin_grant"],
  },
  {
    table: "tb_community_delivery_request",
    column: "payment_provider",
    constraint: "tb_community_delivery_request_payment_provider_check",
    accepts: "mercadopago",
    preserves: ["stripe", "asaas"],
  },
  {
    table: "tb_community_listing_order",
    column: "payment_provider",
    constraint: "tb_community_listing_order_payment_provider_check",
    accepts: "mercadopago",
    preserves: ["stripe", "asaas"],
  },
  {
    table: "tb_profile_product_order",
    column: "processor_fee_source",
    constraint: "tb_profile_product_order_processor_src_chk",
    accepts: "mercadopago_fee",
    preserves: ["fallback", "stripe_balance_tx", "asaas_fee", "manual"],
  },
];

async function snapshot(client) {
  const out = {};
  for (const t of TARGETS) {
    const rows = await checksOn(client, t.table, t.column);
    out[`${t.table}.${t.column}`] = rows.map((r) => `${r.conname}::${r.def}`).sort();
  }
  return out;
}

async function main() {
  if (!(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL)) {
    console.error("Defina DATABASE_URL ou TEST_DATABASE_URL");
    process.exit(1);
  }
  const client = await pool.connect();
  const mig = fs.readFileSync(
    path.join(__dirname, "..", "src", "databases", "migrations", "250_mercadopago_provider.sql"),
    "utf8"
  );

  // O estado REAL de antes. É a ele que o rollback tem que devolver.
  const before = await snapshot(client);

  console.log("\n== mig 250: os CHECKs aprendem o Mercado Pago ==");
  await client.query("BEGIN");
  try {
    await client.query(mig);
    check("migration aplica", true);
    // O runner reaplica no boot de todo deploy.
    await client.query(mig);
    check("2ª aplicação não quebra (idempotente)", true);

    for (const t of TARGETS) {
      const rows = await checksOn(client, t.table, t.column);
      const label = `${t.table}.${t.column}`;

      // ⚠️ O caso que pega a constraint DUPLICADA: se o DROP errar o nome, o
      // ADD passa e a antiga fica de pé em paralelo — a migration é dada como
      // aplicada e o primeiro INSERT ainda é recusado em produção.
      check(`${label}: existe EXATAMENTE UM check`, rows.length === 1, rows.map((r) => r.conname));

      const def = rows[0] ? rows[0].def : "";
      check(`${label}: aceita '${t.accepts}'`, new RegExp(`'${t.accepts}'`).test(def), def);
      check(`${label}: a constraint tem o nome esperado`,
        !!rows[0] && rows[0].conname === t.constraint,
        rows[0] && rows[0].conname);

      // SUPERSET: nada do que já era aceito pode ter saído.
      for (const v of t.preserves) {
        check(`${label}: preserva '${v}'`, new RegExp(`'${v}'`).test(def), def);
      }
    }

    // ── O `IS NULL` das migs 248/249 tem que sobreviver ────────────────────
    //
    // ⚠️ O chamado de delivery NASCE sem provedor (a mig 248 cobra no ACEITE,
    // não na abertura). Perder essa perna faria ABRIR CHAMADO violar a
    // constraint — e o sintoma seria a feature inteira parar, não um detalhe.
    for (const tbl of ["tb_community_delivery_request", "tb_community_listing_order"]) {
      const rows = await checksOn(client, tbl, "payment_provider");
      const def = rows[0] ? rows[0].def : "";
      check(`${tbl}: o CHECK ainda aceita NULL`, /IS NULL/i.test(def), def);
    }

    // ── Os CHECKs exercitados DE VERDADE, sobre linha existente ────────────
    const anyOrder = await client.query(
      `SELECT id_order FROM public.tb_profile_product_order LIMIT 1`
    );
    if (anyOrder.rowCount === 1) {
      const id = anyOrder.rows[0].id_order;
      await client.query(
        `UPDATE public.tb_profile_product_order SET processor_fee_source='mercadopago_fee' WHERE id_order=$1`,
        [id]
      );
      // ⚠️ Passa aqui e a coluna é VARCHAR(20): 'mercadopago_fee' tem 15. Um
      // valor mais longo seria TRUNCADO ou recusado por tipo, não por CHECK —
      // e o `violates` abaixo, que casa pelo NOME, acusaria isso.
      check("UPDATE para 'mercadopago_fee' é ACEITO", true);
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
        `UPDATE public.tb_condo_listing_slot SET payment_provider='mercadopago' WHERE id_slot=$1`,
        [id]
      );
      check("UPDATE da vaga para 'mercadopago' é ACEITO", true);
      const bad = await violates(
        client,
        `UPDATE public.tb_condo_listing_slot SET payment_provider='inventado' WHERE id_slot=$1`,
        [id],
        "tb_condo_listing_slot_provider_chk"
      );
      check("provedor inventado na vaga é recusado PELO NOME", bad.ok, bad.reason);
    } else {
      console.log("  --   (sem vaga em produção: CHECK conferido só pelo catálogo)");
    }

    // ── A intenção aceita o provedor novo e recusa o inventado ─────────────
    const intent = await client.query(
      `INSERT INTO public.tb_payment_intent (provider, flow, amount_cents, currency)
       VALUES ('mercadopago', 'community_delivery', 300, 'BRL')
       RETURNING id_payment_intent`
    );
    check("INSERT de intenção com 'mercadopago' é ACEITO", intent.rowCount === 1);

    const badIntent = await violates(
      client,
      `INSERT INTO public.tb_payment_intent (provider, flow, amount_cents, currency)
       VALUES ('inventado', 'community_delivery', 300, 'BRL')`,
      [],
      "tb_payment_intent_provider_check"
    );
    check("provedor inventado na intenção é recusado PELO NOME", badIntent.ok, badIntent.reason);

    // ── O re-carimbo de provider_ref (o caminho novo do Mercado Pago) ──────
    //
    // ⚠️ É ele que faz o estorno achar a cobrança: `provider_ref` nasce com o id
    // da PREFERÊNCIA e tem que virar o id do PAYMENT quando o webhook chega.
    const PaymentIntentStorage = require("../src/storages/PaymentIntentStorage");
    const intentId = intent.rows[0].id_payment_intent;
    await PaymentIntentStorage.attachProviderRef(client, intentId, {
      provider_ref: "pref_123",
      provider_customer_id: null,
    });
    const afterAttach = await PaymentIntentStorage.getById(client, intentId);
    check("attachProviderRef carimba a preferência", afterAttach.provider_ref === "pref_123");

    // A guarda de `attachProviderRef` continua valendo: ele NÃO sobrescreve.
    await PaymentIntentStorage.attachProviderRef(client, intentId, {
      provider_ref: "pay_999",
      provider_customer_id: null,
    });
    const stillPref = await PaymentIntentStorage.getById(client, intentId);
    check("attachProviderRef NÃO sobrescreve (guarda da mig 231)",
      stillPref.provider_ref === "pref_123", stillPref.provider_ref);

    // O caminho novo sobrescreve — é o que o webhook usa.
    await PaymentIntentStorage.setProviderRef(client, intentId, "pay_999");
    const restamped = await PaymentIntentStorage.getById(client, intentId);
    check("setProviderRef SOBRESCREVE com o id do payment",
      restamped.provider_ref === "pay_999", restamped.provider_ref);

    const foundByPayment = await PaymentIntentStorage.getByProviderRef(
      client, "mercadopago", "pay_999"
    );
    check("a intenção é encontrada pelo id do payment (é o que o estorno usa)",
      !!foundByPayment && foundByPayment.id_payment_intent === intentId);
  } finally {
    await client.query("ROLLBACK");
  }

  console.log("\n== produção voltou ao estado de antes ==");
  const after = await snapshot(client);
  for (const key of Object.keys(before)) {
    check(`${key}: idêntico ao estado de antes do BEGIN`,
      JSON.stringify(before[key]) === JSON.stringify(after[key]),
      { before: before[key], after: after[key] });
  }
  const sujo = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM public.tb_payment_intent WHERE provider='mercadopago') AS intents,
       (SELECT COUNT(*)::int FROM public.tb_profile_product_order WHERE processor_fee_source='mercadopago_fee') AS orders`
  );
  check("nenhuma linha de teste sobrou",
    sujo.rows[0].intents === 0 && sujo.rows[0].orders === 0, sujo.rows[0]);

  client.release();
  await pool.end();
  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
