const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Ensure DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error("ERRO: DATABASE_URL não está configurada no seu arquivo .env");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const MIGRATIONS_DIR = path.join(__dirname, 'src', 'databases', 'migrations');

async function runMigrations() {
  const client = await pool.connect();
  try {
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log("Iniciando migrações...");

    for (const file of files) {
      console.log(`\nRodando: ${file}`);
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`✅ Sucesso: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Erro ao rodar ${file}:`, err.message);
        throw err;
      }
    }
    
    console.log("\n✅ Todas as migrações foram concluídas!");
  } catch (err) {
    console.error("\n❌ Falha no processo de migração:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
