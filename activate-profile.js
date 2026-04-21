const { Pool } = require('pg');
require('dotenv').config({ path: '.env.migrate' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const c = await pool.connect();
  try {
    const r = await c.query(
      `UPDATE tb_profile SET is_active = true, updated_at = NOW()
       WHERE id_profile = '537195af-fcf8-4d40-b4c5-d886693ae41e'
       RETURNING id_profile, is_active`
    );
    console.log('Profile activated:', r.rows);

    await c.query(
      `INSERT INTO tb_profile_status (id_profile, id_status)
       VALUES ('537195af-fcf8-4d40-b4c5-d886693ae41e', 1)
       ON CONFLICT DO NOTHING`
    );
    console.log('Status active added');

    const v = await c.query(
      `SELECT p.is_active, ps.id_status
       FROM tb_profile p
       LEFT JOIN tb_profile_status ps ON ps.id_profile = p.id_profile
       WHERE p.id_profile = '537195af-fcf8-4d40-b4c5-d886693ae41e'`
    );
    console.table(v.rows);
  } finally {
    c.release();
    await pool.end();
  }
})();
