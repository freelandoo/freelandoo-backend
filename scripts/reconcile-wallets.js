// scripts/reconcile-wallets.js — Segurança A2: reconciliação das carteiras.
//
//   node scripts/reconcile-wallets.js            (banco local)
//   node scripts/reconcile-wallets.js --prod     (produção — SÓ LEITURA)
//
// Roda numa transação READ ONLY e imprime SÓ contagens e somas agregadas —
// nenhum id, nome ou e-mail sai daqui. Pronto = todas as divergências em zero
// (ou explicadas no docs/auditoria/A2.md).
//
// Confere:
//   - Gold (polen_wallets) e Esmeralda (emerald_wallets): saldo de cada
//     carteira = soma dos lançamentos 'posted'; nenhum saldo negativo;
//     nenhuma chave (source, source_id) de crédito repetida;
//   - saldo de vendedor (tb_seller_balance): líquido ≤ bruto; 'pago' tem data
//     de repasse; 'revertido' tem data de reversão.
require("dotenv").config();
const { Client } = require("pg");
require("../src/databases/prodGuard").assertDbAllowed(process.env.DATABASE_URL, { label: "DATABASE_URL" });

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(String(process.env.DATABASE_URL || ""));

const LEDGERS = [
  { name: "Gold", wallets: "public.polen_wallets", tx: "public.polen_transactions" },
  { name: "Esmeralda", wallets: "public.emerald_wallets", tx: "public.emerald_transactions" },
];

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocal || process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  await c.connect();
  const out = {};
  try {
    await c.query("BEGIN TRANSACTION READ ONLY");
    for (const L of LEDGERS) {
      const { rows } = await c.query(`
        WITH s AS (
          SELECT w.id, w.balance,
                 COALESCE((SELECT SUM(t.amount) FROM ${L.tx} t WHERE t.wallet_id = w.id AND t.status = 'posted'), 0) AS ledger
            FROM ${L.wallets} w
        )
        SELECT COUNT(*)::int                                   AS carteiras,
               COALESCE(SUM(balance),0)::bigint                AS soma_saldos,
               COALESCE(SUM(ledger),0)::bigint                 AS soma_lancamentos,
               COUNT(*) FILTER (WHERE balance <> ledger)::int  AS carteiras_divergentes,
               COALESCE(SUM(balance - ledger) FILTER (WHERE balance <> ledger),0)::bigint AS diferenca_total,
               COUNT(*) FILTER (WHERE balance < 0)::int        AS saldos_negativos
          FROM s`);
      const dup = await c.query(`
        SELECT COUNT(*)::int AS chaves_repetidas FROM (
          SELECT source, source_id FROM ${L.tx}
           WHERE status = 'posted' AND amount > 0 AND source IS NOT NULL AND source_id IS NOT NULL
           GROUP BY source, source_id HAVING COUNT(*) > 1) d`);
      const orphan = await c.query(`
        SELECT COUNT(*)::int AS lancamentos_sem_carteira FROM ${L.tx} t
         WHERE NOT EXISTS (SELECT 1 FROM ${L.wallets} w WHERE w.id = t.wallet_id)`);
      out[L.name] = { ...rows[0], ...dup.rows[0], ...orphan.rows[0] };
    }
    const sb = await c.query(`
      SELECT COUNT(*)::int AS linhas,
             COUNT(*) FILTER (WHERE net_cents > gross_cents)::int AS liquido_maior_que_bruto,
             COUNT(*) FILTER (WHERE status = 'pago' AND paid_out_at IS NULL)::int AS pago_sem_data,
             COUNT(*) FILTER (WHERE status = 'revertido' AND reverted_at IS NULL)::int AS revertido_sem_data
        FROM public.tb_seller_balance`);
    out["Saldo de vendedor"] = sb.rows[0];
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
  console.log(JSON.stringify(out, null, 2));
  const bad = Object.values(out).some((o) =>
    ["carteiras_divergentes", "saldos_negativos", "chaves_repetidas", "lancamentos_sem_carteira",
     "liquido_maior_que_bruto", "pago_sem_data", "revertido_sem_data"].some((k) => Number(o[k]) > 0)
  );
  process.exit(bad ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(2);
});
