// src/storages/AdminTransactionsStorage.js
module.exports = {
  async listAllTransactions(db) {
    const result = await db.query(`
      WITH subs AS (
        SELECT
          ps.paid_at                      AS occurred_at,
          tu.id_user                      AS id_user,
          tu.nome                         AS user_name,
          tu.email                        AS user_email,
          pro.id_profile                  AS id_profile,
          pro.display_name                AS profile_name,
          ca.desc_category                AS profile_category,
          'assinatura'                    AS tipo,
          ps.amount_cents                 AS amount_cents
        FROM tb_profile_subscription ps
        JOIN tb_user    tu  ON tu.id_user    = ps.id_user
        LEFT JOIN tb_profile pro ON pro.id_profile  = ps.id_profile
        LEFT JOIN tb_category ca ON ca.id_category  = pro.id_category
        WHERE ps.paid_at IS NOT NULL
      ),
      fees AS (
        SELECT
          COALESCE(b.confirmed_at, b.created_at) AS occurred_at,
          tu.id_user                             AS id_user,
          tu.nome                                AS user_name,
          tu.email                               AS user_email,
          pro.id_profile                         AS id_profile,
          pro.display_name                       AS profile_name,
          ca.desc_category                       AS profile_category,
          'taxa_agenda'                          AS tipo,
          b.platform_fee_amount                  AS amount_cents
        FROM tb_profile_bookings b
        JOIN tb_profile pro ON pro.id_profile = b.id_profile
        JOIN tb_user    tu  ON tu.id_user    = b.profile_owner_user_id
        LEFT JOIN tb_category ca ON ca.id_category = pro.id_category
        WHERE b.payment_status = 'paid'
      )
      SELECT * FROM subs
      UNION ALL
      SELECT * FROM fees
      ORDER BY occurred_at DESC NULLS LAST
    `);
    return result.rows;
  },
};
