// Storage de PEDIDOS da Conveniência Views. Os produtos agora vivem na loja
// GLOBAL (CasaStoreStorage); o pedido guarda qual participante recebeu a venda
// (id_participant, atribuição pela página). SQL puro, sem frete.

const ORDER_COLS = `
  id, id_product, id_participant, id_user, buyer_email, product_name, quantity,
  amount_cents, status, stripe_session_id, stripe_payment_intent, stripe_charge_id,
  paid_at, refunded_at, created_at, updated_at
`;

async function getOrderByStripeSession(conn, sessionId) {
  const { rows } = await conn.query(
    `SELECT ${ORDER_COLS} FROM public.casa_participant_product_order WHERE stripe_session_id = $1 LIMIT 1`,
    [sessionId]
  );
  return rows[0] || null;
}

async function getOrderByChargeId(conn, chargeId) {
  const { rows } = await conn.query(
    `SELECT ${ORDER_COLS} FROM public.casa_participant_product_order WHERE stripe_charge_id = $1 LIMIT 1`,
    [chargeId]
  );
  return rows[0] || null;
}

async function getOrderByPaymentIntent(conn, piId) {
  const { rows } = await conn.query(
    `SELECT ${ORDER_COLS} FROM public.casa_participant_product_order WHERE stripe_payment_intent = $1 LIMIT 1`,
    [piId]
  );
  return rows[0] || null;
}

async function createOrder(conn, d) {
  const { rows } = await conn.query(
    `INSERT INTO public.casa_participant_product_order
       (id_product, id_participant, id_user, buyer_email, product_name, quantity, amount_cents, status, stripe_session_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)
     ON CONFLICT (stripe_session_id) DO NOTHING
     RETURNING ${ORDER_COLS}`,
    [d.id_product, d.id_participant, d.id_user ?? null, d.buyer_email ?? null, d.product_name, d.quantity ?? 1, d.amount_cents ?? 0, d.stripe_session_id]
  );
  return rows[0] || null;
}

async function markOrderPaid(conn, sessionId, { stripe_payment_intent, stripe_charge_id }) {
  const { rows } = await conn.query(
    `UPDATE public.casa_participant_product_order
        SET status = 'paid', paid_at = COALESCE(paid_at, NOW()),
            stripe_payment_intent = COALESCE($2, stripe_payment_intent),
            stripe_charge_id = COALESCE($3, stripe_charge_id), updated_at = NOW()
      WHERE stripe_session_id = $1 RETURNING ${ORDER_COLS}`,
    [sessionId, stripe_payment_intent ?? null, stripe_charge_id ?? null]
  );
  return rows[0] || null;
}

async function markOrderRefunded(conn, id) {
  const { rows } = await conn.query(
    `UPDATE public.casa_participant_product_order
        SET status = 'refunded', refunded_at = COALESCE(refunded_at, NOW()), updated_at = NOW()
      WHERE id = $1 RETURNING ${ORDER_COLS}`,
    [id]
  );
  return rows[0] || null;
}

async function markOrderCanceled(conn, sessionId) {
  await conn.query(
    `UPDATE public.casa_participant_product_order SET status = 'canceled', updated_at = NOW() WHERE stripe_session_id = $1`,
    [sessionId]
  );
}

async function listOrdersForUser(conn, id_user, { limit = 50, offset = 0 } = {}) {
  const { rows } = await conn.query(
    `SELECT o.*, p.slug AS participant_slug, p.display_name AS participant_name
       FROM public.casa_participant_product_order o
       JOIN public.casa_participant p ON p.id = o.id_participant
      WHERE o.id_user = $1
      ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
    [id_user, limit, offset]
  );
  return rows;
}

// Admin: pedidos com a atribuição do participante que recebeu a venda.
async function listOrdersAdmin(conn, { limit = 100, offset = 0, status = null } = {}) {
  const where = status ? "WHERE o.status = $3" : "";
  const params = status ? [limit, offset, status] : [limit, offset];
  const { rows } = await conn.query(
    `SELECT o.*, p.slug AS participant_slug, p.display_name AS participant_name,
            u.nome AS buyer_name, u.email AS buyer_user_email
       FROM public.casa_participant_product_order o
       JOIN public.casa_participant p ON p.id = o.id_participant
       LEFT JOIN public.tb_user u ON u.id_user = o.id_user
       ${where}
      ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`,
    params
  );
  return rows;
}

module.exports = {
  getOrderByStripeSession, getOrderByChargeId, getOrderByPaymentIntent,
  createOrder, markOrderPaid, markOrderRefunded, markOrderCanceled,
  listOrdersForUser, listOrdersAdmin,
};
