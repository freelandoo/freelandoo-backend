const { Pool } = require('pg');
require('dotenv').config({ path: '.env.migrate' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const c = await pool.connect();
  try {
    const r = await c.query(`
      SELECT
        tu.id_user,
        tu.avatar,
        tu.nome,
        tu.username,
        tu.data_nascimento,
        EXTRACT(YEAR FROM AGE(CURRENT_DATE, tu.data_nascimento)) AS idade,
        tu.sexo,
        tu.email,
        tu.telefone,
        tu.ativo,
        tu.bio,
        tu.estado,
        tu.municipio
      FROM tb_user tu
      WHERE tu.email = 'alex.rodriguus@gmail.com'
    `);
    console.log('Result:', JSON.stringify(r.rows[0], null, 2));
  } finally {
    c.release();
    await pool.end();
  }
})();
