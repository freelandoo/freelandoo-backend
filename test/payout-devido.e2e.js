// test/payout-devido.e2e.js — Segurança A2 (A2-06): estorno DEPOIS do repasse vira dívida.
//
//   npm run test:payout-devido
//
// Para cada um dos 6 repasses (agenda, clã, delivery, vitrine, loja, vaquinha) cria, numa
// transação que é desfeita no fim (FKs desligadas só nela: `session_replication_role = replica`),
// um repasse PAGO e um APROVADO e chama a função de reversão REAL do storage — a mesma que o
// webhook de estorno chama:
//   • pago      → 'devido' (o dinheiro já saiu: quem recebeu deve; antes ficava 'pago' e ninguém via,
//                 e a vaquinha marcava 'revertido', apagando o pagamento);
//   • aprovado  → 'revertido' (não saiu nada);
//   • rodar de novo não muda nada (o webhook chega mais de uma vez).
// Contra o Postgres LOCAL de teste (porta 55432).
const url = process.env.TEST_DATABASE_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DATABASE_SSL = "false";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";

const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

let PASS = 0;
let FAIL = 0;
function check(label, cond, extra = "") {
  if (cond) {
    PASS++;
    console.log(`  ✓ ${label}`);
  } else {
    FAIL++;
    console.log(`  ✗ ${label}${extra ? " — " + extra : ""}`);
  }
}

execFileSync(process.execPath, ["run-migrations.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env }, stdio: "ignore" });
const pool = require("../src/databases");

const BookingPayoutStorage = require("../src/storages/BookingPayoutStorage");
const ClanPayoutStorage = require("../src/storages/ClanPayoutStorage");
const CommunityDeliveryStorage = require("../src/storages/CommunityDeliveryStorage");
const CommunityListingOrderStorage = require("../src/storages/CommunityListingOrderStorage");
const SellerBalanceStorage = require("../src/storages/SellerBalanceStorage");
const VaquinhaStorage = require("../src/storages/VaquinhaStorage");

/** Valor de mentira para uma coluna NOT NULL sem padrão, pelo tipo. */
function dummy(col, type, key) {
  if (col === "status") return "pago";
  if (/uuid/.test(type)) return crypto.randomUUID();
  if (/int|numeric|double|real/.test(type)) return key;
  if (/timestamp|date/.test(type)) return new Date();
  if (/bool/.test(type)) return false;
  if (/json/.test(type)) return "{}";
  return `x${key}`;
}

async function seed(c, table, overrides) {
  const cols = (
    await c.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND is_nullable = 'NO' AND column_default IS NULL`,
      [table]
    )
  ).rows;
  const row = {};
  let k = Math.floor(Math.random() * 1e6) + 1000;
  for (const { column_name, data_type } of cols) row[column_name] = dummy(column_name, data_type, k++);
  Object.assign(row, overrides);
  const names = Object.keys(row);
  await c.query(`INSERT INTO public.${table} (${names.join(",")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row));
}

// tabela, coluna-chave da reversão, chamada da reversão, extra para a linha
const CASES = [
  ["tb_booking_payout", "id_booking", (c, k) => BookingPayoutStorage.revertByBooking(c, k), (k) => ({ id_booking: k })],
  ["tb_clan_payout", "source_id", (c, k) => ClanPayoutStorage.revertBySource(c, "clan_service", k), (k) => ({ source_type: "clan_service", source_id: String(k) })],
  ["tb_community_delivery_payout", "id_delivery", (c, k) => CommunityDeliveryStorage.revertPayout(c, k), (k) => ({ id_delivery: k })],
  ["tb_community_listing_payout", "id_order", (c, k) => CommunityListingOrderStorage.revertPayout(c, k), (k) => ({ id_order: k })],
  ["tb_seller_balance", "id_order", (c, k) => SellerBalanceStorage.revertByOrder(c, k), (k) => ({ id_order: k })],
  ["tb_vaquinha_payout", "id_donation", (c, k) => VaquinhaStorage.revertPayoutByDonation(c, k), (k) => ({ id_donation: k })],
];

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    for (const [table, keyCol, revert, extra] of CASES) {
      console.log(`\n▶ ${table}`);
      const keyType = (
        await c.query(`SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [table, keyCol])
      ).rows[0].data_type;
      const mk = () => (/uuid/.test(keyType) ? crypto.randomUUID() : /char|text/.test(keyType) ? `k${crypto.randomBytes(4).toString("hex")}` : Math.floor(Math.random() * 1e9) + 1);
      const kPago = mk();
      const kAprov = mk();
      await seed(c, table, { ...extra(kPago), status: "pago" });
      await seed(c, table, { ...extra(kAprov), status: "aprovado" });
      const st = async (k) => (await c.query(`SELECT status FROM public.${table} WHERE ${keyCol} = $1`, [table === "tb_clan_payout" ? String(k) : k])).rows[0]?.status;

      await revert(c, kPago);
      check("repasse PAGO estornado vira 'devido'", (await st(kPago)) === "devido", await st(kPago));
      await revert(c, kAprov);
      check("repasse APROVADO estornado vira 'revertido'", (await st(kAprov)) === "revertido", await st(kAprov));
      await revert(c, kPago);
      await revert(c, kAprov);
      check("o estorno repetido não muda nada", (await st(kPago)) === "devido" && (await st(kAprov)) === "revertido");
    }
  } catch (e) {
    FAIL++;
    console.error(e);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
    console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
    await pool.end().catch(() => {});
    process.exit(FAIL ? 1 : 0);
  }
})();
