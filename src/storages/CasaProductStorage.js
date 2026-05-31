// Storage da lojinha "Conveniência Views" — produtos por participante + pedidos.
// SQL puro. Sem frete, sem seller balance: checkout Stripe single-item.

const PRODUCT_COLS = `
  id, id_participant, name, description, image_url, price_cents, stock,
  is_active, sort_order, created_at, updated_at
`;

// ───────────────────────── Produtos ─────────────────────────

async function listProducts(conn, id_participant, { onlyActive = false } = {}) {
  const where = onlyActive ? "AND is_active = TRUE" : "";
  const { rows } = await conn.query(
    `SELECT ${PRODUCT_COLS}
       FROM public.casa_participant_product
      WHERE id_participant = $1 ${where}
      ORDER BY sort_order ASC, created_at ASC`,
    [id_participant]
  );
  return rows;
}

async function getProductById(conn, id) {
  const { rows } = await conn.query(
    `SELECT ${PRODUCT_COLS} FROM public.casa_participant_product WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function createProduct(conn, d) {
  const { rows } = await conn.query(
    `INSERT INTO public.casa_participant_product
       (id_participant, name, description, image_url, price_cents, stock, is_active, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING ${PRODUCT_COLS}`,
    [
      d.id_participant, d.name, d.description, d.image_url,
      d.price_cents ?? 0, d.stock ?? null, d.is_active ?? true, d.sort_order ?? 0,
    ]
  );
  return rows[0] || null;
}

async function updateProduct(conn, id, patch) {
  const cols = ["name", "description", "image_url", "price_cents", "stock", "is_active", "sort_order"];
  const sets = []; const vals = []; let i = 1;
  for (const c of cols) if (patch[c] !== undefined) { sets.push(`${c} = $${i++}`); vals.push(patch[c]); }
  if (!sets.length) return getProductById(conn, id);
  vals.push(id);
  const { rows } = await conn.query(
    `UPDATE public.casa_participant_product SET ${sets.join(", ")}, updated_at = NOW()
      WHERE id = $${i} RETURNING ${PRODUCT_COLS}`,
    vals
  );
  return rows[0] || null;
}

// Soft delete (is_active=false) para não quebrar FK de pedidos existentes.
async function deleteProduct(conn, id) {
  const { rows } = await conn.query(
    `UPDATE public.casa_participant_product SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1 RETURNING ${PRODUCT_COLS}`,
    [id]
  );
  return rows[0] || null;
}

// Decrementa estoque atômico; retorna true se reservou (ou se estoque ilimitado).
async function reserveStock(conn, id) {
  const { rows } = await conn.query(
    `UPDATE public.casa_participant_product
        SET stock = CASE WHEN stock IS NULL THEN NULL ELSE stock - 1 END,
            updated_at = NOW()
      WHERE id = $1 AND (stock IS NULL OR stock > 0)
      RETURNING id, stock`,
    [id]
  );
  return rows.length > 0;
}

async function restoreStock(conn, id) {
  await conn.query(
    `UPDATE public.casa_participant_product
        SET stock = CASE WHEN stock IS NULL THEN NULL ELSE stock + 1 END,
            updated_at = NOW()
      WHERE id = $1`,
    [id]
  );
}

// ───────────────────────── Pedidos ─────────────────────────

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
       (id_product, id_participant, id_user, buyer_email, product_name, quantity,
        amount_cents, status, stripe_session_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)
     ON CONFLICT (stripe_session_id) DO NOTHING
     RETURNING ${ORDER_COLS}`,
    [
      d.id_product, d.id_participant, d.id_user ?? null, d.buyer_email ?? null,
      d.product_name, d.quantity ?? 1, d.amount_cents ?? 0, d.stripe_session_id,
    ]
  );
  return rows[0] || null;
}

async function markOrderPaid(conn, sessionId, { stripe_payment_intent, stripe_charge_id }) {
  const { rows } = await conn.query(
    `UPDATE public.casa_participant_product_order
        SET status = 'paid',
            paid_at = COALESCE(paid_at, NOW()),
            stripe_payment_intent = COALESCE($2, stripe_payment_intent),
            stripe_charge_id = COALESCE($3, stripe_charge_id),
            updated_at = NOW()
      WHERE stripe_session_id = $1
      RETURNING ${ORDER_COLS}`,
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

async function listOrdersForUser(conn, id_user, { limit = 50, offset = 0 } = {}) {
  const { rows } = await conn.query(
    `SELECT o.*, p.slug AS participant_slug, p.display_name AS participant_name
       FROM public.casa_participant_product_order o
       JOIN public.casa_participant p ON p.id = o.id_participant
      WHERE o.id_user = $1
      ORDER BY o.created_at DESC
      LIMIT $2 OFFSET $3`,
    [id_user, limit, offset]
  );
  return rows;
}

module.exports = {
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  reserveStock,
  restoreStock,
  getOrderByStripeSession,
  getOrderByChargeId,
  getOrderByPaymentIntent,
  createOrder,
  markOrderPaid,
  markOrderRefunded,
  listOrdersForUser,
};
