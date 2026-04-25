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
      ssl: { rejectUnauthorized: false }
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

app.listen(PORT, () => {
  bootLog.info("server.listen", { port: PORT });
});
