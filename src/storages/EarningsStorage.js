/**
 * EarningsStorage — agrega "faturamentos" do user logado a partir de:
 *  - tb_seller_balance       (vendas da Loja)
 *  - tb_booking_payout       (vendas de Serviços / Agendamentos)
 *  - course_enrollments      (matrículas pagas em cursos do user)
 *  - tb_affiliate_conversion (comissões de cupom como afiliado)
 *
 * As 4 fontes têm schemas distintos. Aqui as projetamos pra um shape comum:
 *   { kind, id, ref_id, title, status, gross_cents, net_cents,
 *     created_at, available_at, paid_at, meta }
 *
 * Status é normalizado:
 *   - "pending"   → ainda em holdback (não recebível)
 *   - "available" → liberado (recebível ou pago)
 *   - "paid"      → já pago
 *   - "reversed"  → revertido / reembolsado
 */

const KINDS = ["service", "product", "course", "affiliate"];

function normalizeKindFilter(kind) {
  if (!kind || kind === "all") return null;
  return KINDS.includes(kind) ? kind : null;
}

const STORE_QUERY = `
  SELECT
    'product'::text                     AS kind,
    sb.id_balance::text                 AS id,
    ppo.id_order::text                  AS ref_id,
    COALESCE(pp.name, 'Produto')        AS title,
    CASE
      WHEN sb.status = 'revertido' THEN 'reversed'
      WHEN sb.status = 'pago'      THEN 'paid'
      WHEN sb.status = 'aprovado'  THEN 'available'
      ELSE 'pending'
    END                                 AS status,
    sb.gross_cents                      AS gross_cents,
    sb.net_cents                        AS net_cents,
    sb.created_at                       AS created_at,
    sb.available_at                     AS available_at,
    sb.paid_out_at                      AS paid_at,
    jsonb_build_object(
      'buyer_name',     ppo.buyer_name,
      'quantity',       ppo.quantity,
      'status_order',   ppo.status,
      'platform_fee_cents', sb.platform_fee_cents,
      'shipping_cents', sb.shipping_cents
    )                                   AS meta
  FROM public.tb_seller_balance sb
  JOIN public.tb_profile_product_order ppo
    ON ppo.id_order = sb.id_order
  LEFT JOIN public.tb_profile_product pp
    ON pp.id_profile_product = ppo.id_profile_product
  WHERE sb.id_seller_user = $1
`;

const SERVICE_QUERY = `
  SELECT
    'service'::text                                          AS kind,
    bp.id_payout::text                                       AS id,
    bp.id_booking::text                                      AS ref_id,
    COALESCE(ps.name, 'Serviço')                             AS title,
    CASE
      WHEN bp.status = 'revertido' THEN 'reversed'
      WHEN bp.status = 'pago'      THEN 'paid'
      WHEN bp.status = 'aprovado'  THEN 'available'
      ELSE 'pending'
    END                                                      AS status,
    bp.deposit_cents                                         AS gross_cents,
    bp.net_cents                                             AS net_cents,
    bp.created_at                                            AS created_at,
    bp.available_at                                          AS available_at,
    bp.paid_out_at                                           AS paid_at,
    jsonb_build_object(
      'client_name',         bp.client_name,
      'booking_date',        bp.booking_date,
      'booking_start_time',  bp.booking_start_time,
      'platform_fee_cents',  bp.platform_fee_cents,
      'professional_cents',  bp.professional_cents
    )                                                        AS meta
  FROM public.tb_booking_payout bp
  LEFT JOIN public.tb_profile_service ps
    ON ps.id_profile_service = bp.id_profile_service
  WHERE bp.id_owner_user = $1
`;

const COURSE_QUERY = `
  SELECT
    'course'::text                       AS kind,
    ce.id::text                          AS id,
    ce.id::text                          AS ref_id,
    COALESCE(c.title, 'Curso')           AS title,
    CASE
      WHEN ce.status = 'refunded' THEN 'reversed'
      WHEN ce.status = 'canceled' THEN 'reversed'
      ELSE 'paid'
    END                                  AS status,
    ce.amount_paid_cents                 AS gross_cents,
    ce.amount_paid_cents                 AS net_cents,
    ce.created_at                        AS created_at,
    ce.enrolled_at                       AS available_at,
    ce.enrolled_at                       AS paid_at,
    jsonb_build_object(
      'student_user_id', ce.user_id,
      'enrollment_status', ce.status
    )                                    AS meta
  FROM public.course_enrollments ce
  JOIN public.courses c ON c.id = ce.course_id
  WHERE c.owner_user_id = $1
    AND ce.amount_paid_cents > 0
`;

const AFFILIATE_QUERY = `
  SELECT
    'affiliate'::text                              AS kind,
    ac.id_conversion::text                         AS id,
    ac.id_conversion::text                         AS ref_id,
    COALESCE('Cupom ' || cp.code, 'Afiliado')      AS title,
    CASE
      WHEN ac.status = 'REVERSED' THEN 'reversed'
      WHEN ac.status = 'PAID'     THEN 'paid'
      WHEN ac.status = 'APPROVED' AND ac.holdback_until IS NOT NULL AND ac.holdback_until > NOW() THEN 'pending'
      WHEN ac.status = 'APPROVED' THEN 'available'
      ELSE 'pending'
    END                                            AS status,
    ac.order_total_cents                           AS gross_cents,
    ac.commission_cents                            AS net_cents,
    ac.created_at                                  AS created_at,
    COALESCE(ac.eligible_at, ac.holdback_until)    AS available_at,
    ac.paid_at                                     AS paid_at,
    jsonb_build_object(
      'coupon_code',        cp.code,
      'commission_percent', ac.commission_percent,
      'discount_cents',     ac.discount_cents,
      'holdback_until',     ac.holdback_until
    )                                              AS meta
  FROM public.tb_affiliate_conversion ac
  LEFT JOIN public.tb_coupon cp ON cp.id_coupon = ac.id_coupon
  JOIN public.tb_affiliate af   ON af.id_affiliate = ac.id_affiliate
  WHERE af.id_user = $1
`;

function buildUnion(kindFilter) {
  const parts = [];
  if (!kindFilter || kindFilter === "product")   parts.push(STORE_QUERY);
  if (!kindFilter || kindFilter === "service")   parts.push(SERVICE_QUERY);
  if (!kindFilter || kindFilter === "course")    parts.push(COURSE_QUERY);
  if (!kindFilter || kindFilter === "affiliate") parts.push(AFFILIATE_QUERY);
  if (parts.length === 0) return null;
  return parts.join("\nUNION ALL\n");
}

async function listEarnings(db, { userId, kind, limit = 30, offset = 0 }) {
  const kf = normalizeKindFilter(kind);
  const union = buildUnion(kf);
  if (!union) return { items: [], total: 0 };

  const itemsSql = `
    WITH all_rows AS (${union})
    SELECT *
      FROM all_rows
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3
  `;
  const countSql = `
    WITH all_rows AS (${union})
    SELECT COUNT(*)::int AS c FROM all_rows
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

async function aggregates(db, userId) {
  const sql = `
    WITH all_rows AS (
      ${buildUnion(null)}
    )
    SELECT
      kind,
      status,
      COUNT(*)::int                    AS count,
      COALESCE(SUM(net_cents), 0)::int AS net_cents
      FROM all_rows
     GROUP BY kind, status
  `;
  const r = await db.query(sql, [userId]);

  // Reshape: { totals: { received, pending, available, reversed }, by_kind: { service: { received, pending, ... }, ... } }
  const out = {
    by_kind: { service: {}, product: {}, course: {}, affiliate: {} },
    totals: { received: 0, pending: 0, available: 0, reversed: 0, count: 0 },
  };
  for (const row of r.rows) {
    if (!out.by_kind[row.kind]) out.by_kind[row.kind] = {};
    const bucket = row.status === "paid" ? "received" : row.status;
    out.by_kind[row.kind][bucket] = (out.by_kind[row.kind][bucket] || 0) + row.net_cents;
    out.by_kind[row.kind][`${bucket}_count`] =
      (out.by_kind[row.kind][`${bucket}_count`] || 0) + row.count;

    out.totals[bucket] = (out.totals[bucket] || 0) + row.net_cents;
    out.totals.count += row.count;
  }
  return out;
}

module.exports = {
  listEarnings,
  aggregates,
};
