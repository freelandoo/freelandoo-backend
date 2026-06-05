// src/storages/AdminTransactionsStorage.js
//
// Extrato único de RECEITA da plataforma (Entradas). Une as 6 fontes de
// dinheiro que a plataforma GANHA e fica. Repasses (payout de terceiros) NÃO
// entram aqui — ficam na seção Repasses.
//
// ⚠️ Poléns gasto em Premium/Manifestação NÃO conta como receita: a receita já
// foi contada na compra dos poléns (venda_polens). Por isso Premium e
// Manifestação filtram payment_method = 'stripe' (paga em R$), nunca 'polens'.
module.exports = {
  /**
   * @param {import('pg').Pool} db
   * @param {{ tipo?: string|null, from?: string|null, to?: string|null }} [filters]
   */
  async listAllTransactions(db, filters = {}) {
    const tipo = filters.tipo || null;
    const from = filters.from || null;
    const to = filters.to || null;

    const result = await db.query(
      `
      WITH subs AS (
        -- 1) Ativação de perfil (assinatura vitalícia/anual)
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
        -- 2) Taxa de agendamento (só a taxa da plataforma, não o bruto)
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
          AND COALESCE(b.platform_fee_amount, 0) > 0
      ),
      store AS (
        -- 3) Comissão da Loja (service_fee = comissão da plataforma; processor
        --    fee e frete são custo/repasse, não entram). Contexto = vendedor.
        SELECT
          o.paid_at                       AS occurred_at,
          su.id_user                      AS id_user,
          su.nome                         AS user_name,
          su.email                        AS user_email,
          pro.id_profile                  AS id_profile,
          pro.display_name                AS profile_name,
          ca.desc_category                AS profile_category,
          'comissao_loja'                 AS tipo,
          o.service_fee_cents             AS amount_cents
        FROM tb_profile_product_order o
        JOIN tb_user    su  ON su.id_user    = o.id_seller_user
        LEFT JOIN tb_profile pro ON pro.id_profile = o.id_seller_profile
        LEFT JOIN tb_category ca ON ca.id_category = pro.id_category
        WHERE o.paid_at IS NOT NULL
          AND o.refunded_at IS NULL
          AND COALESCE(o.service_fee_cents, 0) > 0
      ),
      polens AS (
        -- 4) Venda de Poléns (Stripe). É AQUI que a receita de poléns entra.
        SELECT
          pp.paid_at                      AS occurred_at,
          tu.id_user                      AS id_user,
          tu.nome                         AS user_name,
          tu.email                        AS user_email,
          NULL::uuid                      AS id_profile,
          NULL::text                      AS profile_name,
          NULL::text                      AS profile_category,
          'venda_polens'                  AS tipo,
          pp.amount_cents                 AS amount_cents
        FROM polen_purchases pp
        JOIN tb_user tu ON tu.id_user = pp.user_id
        WHERE pp.status = 'paid'
          AND pp.refunded_at IS NULL
      ),
      premium AS (
        -- 5) Premium pago em R$ (NÃO os pagos em poléns — senão dobra).
        SELECT
          COALESCE(ppr.activated_at, ppr.created_at) AS occurred_at,
          tu.id_user                      AS id_user,
          tu.nome                         AS user_name,
          tu.email                        AS user_email,
          pro.id_profile                  AS id_profile,
          pro.display_name                AS profile_name,
          ca.desc_category                AS profile_category,
          'premium'                       AS tipo,
          ppr.amount_cents                AS amount_cents
        FROM profile_premium ppr
        JOIN tb_profile pro ON pro.id_profile = ppr.profile_id
        JOIN tb_user    tu  ON tu.id_user    = pro.id_user
        LEFT JOIN tb_category ca ON ca.id_category = pro.id_category
        WHERE ppr.payment_method = 'stripe'
          AND ppr.refunded_at IS NULL
          AND COALESCE(ppr.amount_cents, 0) > 0
          AND ppr.status IN ('active', 'expired')
      ),
      manifestation AS (
        -- 6) Manifestação paga em R$ (NÃO as pagas em poléns).
        SELECT
          um.acquired_at                  AS occurred_at,
          tu.id_user                      AS id_user,
          tu.nome                         AS user_name,
          tu.email                        AS user_email,
          NULL::uuid                      AS id_profile,
          NULL::text                      AS profile_name,
          NULL::text                      AS profile_category,
          'manifestacao'                  AS tipo,
          um.amount_cents                 AS amount_cents
        FROM user_manifestations um
        JOIN tb_user tu ON tu.id_user = um.user_id
        WHERE um.payment_method = 'stripe'
          AND um.refunded_at IS NULL
          AND COALESCE(um.amount_cents, 0) > 0
      ),
      all_tx AS (
        SELECT * FROM subs
        UNION ALL SELECT * FROM fees
        UNION ALL SELECT * FROM store
        UNION ALL SELECT * FROM polens
        UNION ALL SELECT * FROM premium
        UNION ALL SELECT * FROM manifestation
      )
      SELECT *
      FROM all_tx
      WHERE ($1::text IS NULL OR tipo = $1)
        AND ($2::timestamptz IS NULL OR occurred_at >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR occurred_at <= $3::timestamptz)
      ORDER BY occurred_at DESC NULLS LAST
      `,
      [tipo, from, to]
    );
    return result.rows;
  },

  /**
   * Total por tipo (cents) respeitando os mesmos filtros. Usado pelos cards.
   */
  async totalsByType(db, filters = {}) {
    const tipo = filters.tipo || null;
    const from = filters.from || null;
    const to = filters.to || null;

    const rows = await this.listAllTransactions(db, { tipo, from, to });
    const totals = {};
    let grand = 0;
    for (const r of rows) {
      const cents = Number(r.amount_cents) || 0;
      totals[r.tipo] = (totals[r.tipo] || 0) + cents;
      grand += cents;
    }
    return { by_type: totals, total_cents: grand, count: rows.length };
  },
};
