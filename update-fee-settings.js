require('dotenv').config({ path: '.env.migrate' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE public.tb_annual_fee_settings 
       SET stripe_product_id = $1, 
           stripe_price_id = $2, 
           updated_at = NOW() 
       WHERE id = 1 
       RETURNING *`,
      ['prod_UOfXXckyPSiW6P', 'price_1TPsCXBHk3bOLT3lgZM6VQCy']
    );
    console.log('Updated:', JSON.stringify(res.rows[0], null, 2));
  } finally {
    client.release();
    await pool.end();
  }
})();
