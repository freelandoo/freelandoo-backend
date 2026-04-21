const { Pool } = require('pg');
require('dotenv').config({ path: '.env.migrate' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  const client = await pool.connect();
  try {
    const c = await client.query('SELECT * FROM tb_category WHERE id_category = 13');
    console.log('\n== tb_category id=13 ==');
    console.table(c.rows);

    const divulgacao = await client.query(
      `SELECT id_category, desc_category, id_machine FROM tb_category
       WHERE LOWER(desc_category) LIKE '%influen%' OR LOWER(desc_category) LIKE '%divulg%' OR LOWER(desc_category) LIKE '%creator%' OR LOWER(desc_category) LIKE '%ugc%'
       ORDER BY id_category`
    );
    console.log('\n== categorias divulgação-like ==');
    console.table(divulgacao.rows);

    const statuses = await client.query('SELECT * FROM tb_status ORDER BY id_status');
    console.log('\n== tb_status ==');
    console.table(statuses.rows);
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
