require("dotenv").config();

const app = require("./src/app");
const { createLogger } = require("./src/utils/logger");

const bootLog = createLogger("boot");

// --- MIGRATION ENDPOINT TEMPORARIO ---
app.get("/run-migrations-now", async (req, res) => {
  try {
    const { Pool } = require('pg');
    const fs = require('fs');
    const path = require('path');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
    });
    const dir = path.join(__dirname, 'src', 'databases', 'migrations');
    const client = await pool.connect();
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    let logs = [];
    for (let f of files) {
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      logs.push(`✅ Sucesso: ${f}`);
    }
    client.release();
    res.json({ message: "Migrações Concluídas com Sucesso!", logs });
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});
// -------------------------------------

// porta vinda do .env ou fallback
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  bootLog.info("server.listen", { port: PORT });

  // Scheduler do ranking: checa e recalcula a cada 2 horas.
  const pool = require("./src/databases");
  const RankingStorage = require("./src/storages/RankingStorage");
  const SellerBalanceStorage = require("./src/storages/SellerBalanceStorage");
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const tickRanking = async () => {
    try {
      const result = await RankingStorage.runScheduledRecalculate(pool);
      if (!result.skipped) bootLog.info("ranking.auto_recalculated", result);
    } catch (err) {
      bootLog.error("ranking.scheduler_error", { message: err.message });
    }
  };
  // Primeira checagem 2 min após o boot, depois a cada 2 horas.
  setTimeout(tickRanking, 2 * 60 * 1000);
  setInterval(tickRanking, TWO_HOURS);

  // Job CDC: libera saldos do vendedor cujo holdback de 8 dias venceu.
  const tickSellerBalances = async () => {
    try {
      const rows = await SellerBalanceStorage.releaseDue(pool);
      if (rows.length) bootLog.info("seller_balance.released", { count: rows.length });
    } catch (err) {
      bootLog.error("seller_balance.scheduler_error", { message: err.message });
    }
  };
  setTimeout(tickSellerBalances, 3 * 60 * 1000);
  setInterval(tickSellerBalances, TWO_HOURS);
});

// Slice 7 (vídeo de curso): uploads até 100MB podem demorar minutos em
// conexões lentas. Padrão do Node é 0 (sem timeout) em versões recentes
// mas Express historicamente coloca 120s. Subimos explicitamente para
// 15 min e desativamos requestTimeout para o body parse não cortar no meio.
// Railway tem proxy próprio (~5min) — quando virar gargalo, migrar para
// worker queue / upload direto R2 (presigned).
server.requestTimeout = 0;
server.headersTimeout = 16 * 60 * 1000;
server.keepAliveTimeout = 15 * 60 * 1000;
server.timeout = 15 * 60 * 1000;
