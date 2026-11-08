// A7 — ensaio das migrations 329–333 em BEGIN/ROLLBACK (nada fica gravado).
//
// Uso (produção, do computador local):
//   DATABASE_URL=<DATABASE_PUBLIC_URL do serviço Postgres> node scripts/a7-rehearsal.js
//
// Imprime: carteiras redenominadas, soma antes/depois (Pólens → Gold), maior
// sobra de arredondamento, moedas do Meu Mundo migradas e o resultado de cada
// migration. Sempre termina em ROLLBACK.
const fs = require("fs")
const path = require("path")
const { Client } = require("pg")

const MIGS = [
  "329_gold_redenomination.sql",
  "330_emerald_wallet.sql",
  "331_gold_coupon.sql",
  "332_meu_mundo_emerald.sql",
  "333_engagement_emerald.sql",
]

;(async () => {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL obrigatório")
  const c = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } })
  await c.connect()
  try {
    await c.query("BEGIN")
    const before = (await c.query(`SELECT COUNT(*)::int n, COALESCE(SUM(balance),0)::bigint s FROM polen_wallets`)).rows[0]
    const mm = (await c.query(`SELECT COUNT(*)::int n, COALESCE(SUM(FLOOR(coins)),0)::bigint s FROM tb_mm_wallet`)).rows[0]
    const applied = (await c.query(`SELECT filename FROM schema_migrations WHERE filename = ANY($1) AND success`, [MIGS])).rows
    if (applied.length) console.log("já aplicadas:", applied.map((r) => r.filename).join(", "))
    for (const m of MIGS) {
      const t0 = Date.now()
      await c.query(fs.readFileSync(path.join(__dirname, "../src/databases/migrations", m), "utf8"))
      console.log(`ok ${m} (${Date.now() - t0} ms)`)
    }
    const after = (await c.query(`SELECT COUNT(*)::int n, COALESCE(SUM(balance),0)::bigint s FROM polen_wallets`)).rows[0]
    const red = (await c.query(
      `SELECT COUNT(*)::int n,
              COALESCE(MAX(amount * 100 - (metadata->>'old_balance')::int), 0)::int max_sobra,
              COUNT(*) FILTER (WHERE amount * 100 < (metadata->>'old_balance')::int)::int perdeu
         FROM polen_transactions WHERE type = 'redenomination'`
    )).rows[0]
    const em = (await c.query(`SELECT COUNT(*)::int n, COALESCE(SUM(amount),0)::bigint s FROM emerald_transactions WHERE type = 'earn_coin_migration'`)).rows[0]
    console.log(JSON.stringify({
      carteiras: before.n,
      redenominadas: red.n,
      soma_antes_polens: Number(before.s),
      soma_depois_gold: Number(after.s),
      soma_depois_em_polens: Number(after.s) * 100,
      maior_sobra_polens: red.max_sobra,
      carteiras_que_perderam: red.perdeu,
      meu_mundo_carteiras: mm.n,
      meu_mundo_moedas_inteiras: Number(mm.s),
      esmeralda_migrada: Number(em.s),
      esmeralda_linhas: em.n,
    }, null, 2))
  } finally {
    await c.query("ROLLBACK").catch(() => {})
    await c.end()
    console.log("ROLLBACK — nada foi gravado.")
  }
})().catch((e) => {
  console.error("FALHOU:", e.message)
  process.exit(1)
})
