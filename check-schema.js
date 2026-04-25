const { Pool } = require('pg');
require('dotenv').config({ path: '.env.migrate' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const c = await pool.connect();
  try {
    // Check if username column exists
    const r = await c.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tb_user' 
      AND column_name IN ('username', 'estado', 'municipio')
      ORDER BY column_name
    `);
    console.log('Columns in tb_user:');
    console.table(r.rows);

    if (r.rows.length === 0) {
      console.log('ERROR: username column does not exist! Migration 006 was not applied.');
    }
  } finally {
    c.release();
    await pool.end();
  }
})();
