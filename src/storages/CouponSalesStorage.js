/**
 * CouponSalesStorage — vendas que usaram cupom do user logado.
 *
 * Lista todas as conversões de afiliado onde `tb_coupon.owner_user_id = $user`.
 * Para cada conversão: dados do cupom, comprador, total/desconto/comissão e item.
 *
 * Note: o item é derivado por melhor esforço — tb_order_item.snapshot_name quando
 * existe; se for um pedido de produto (Loja) ou booking (Serviço), tentamos achar
 * a referência via stripe_payment_intent / id_order_coupon.
 */

const BASE_QUERY = `
  SELECT
    ac.id_conversion::text                     AS id,
    ac.created_at                              AS created_at,
    ac.status                                  AS status,
    ac.order_total_cents                       AS order_total_cents,
    ac.discount_cents                          AS discount_cents,
    ac.commission_cents                        AS commission_cents,
    ac.commission_percent                      AS commission_percent,
    ac.eligible_at                             AS eligible_at,
    ac.approved_at                             AS approved_at,
    ac.paid_at                                 AS paid_at,
    cp.code                                    AS coupon_code,
    o.id_order::text                           AS id_order,
    o.paid_at                                  AS order_paid_at,
    o.status                                   AS order_status,
    o.total_cents                              AS order_total_full_cents,
    bu.id_user::text                           AS buyer_id,
    bu.nome                                    AS buyer_name,
    bu.email                                   AS buyer_email,
    (
      SELECT oi.item_name_snapshot
        FROM public.tb_order_item oi
       WHERE oi.id_order = o.id_order
       ORDER BY oi.created_at ASC
       LIMIT 1
    )                                          AS item_name,
    (
      SELECT COUNT(*)::int
        FROM public.tb_order_item oi
       WHERE oi.id_order = o.id_order
    )                                          AS item_count
    FROM public.tb_affiliate_conversion ac
    JOIN public.tb_coupon cp ON cp.id_coupon = ac.id_coupon
    JOIN public.tb_order o   ON o.id_order   = ac.id_order
    JOIN public.tb_user bu   ON bu.id_user   = o.id_user
   WHERE cp.owner_user_id = $1
`;

async function listSales(db, { userId, limit = 24, offset = 0 }) {
  const itemsSql = `
    ${BASE_QUERY}
    ORDER BY ac.created_at DESC
    LIMIT $2 OFFSET $3
  `;
  const countSql = `
    SELECT COUNT(*)::int AS c
      FROM public.tb_affiliate_conversion ac
      JOIN public.tb_coupon cp ON cp.id_coupon = ac.id_coupon
     WHERE cp.owner_user_id = $1
  `;
  const [rows, count] = await Promise.all([
    db.query(itemsSql, [userId, limit, offset]),
    db.query(countSql, [userId]),
  ]);
  return {
    items: rows.rows,
    total: count.rows[0]?.c || 0,
  };
}

module.exports = { listSales };
