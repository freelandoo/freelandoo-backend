/**
 * MeiStorage — perfil fiscal do prestador (mei_profile) + recibos emitidos
 * (mei_receipt). SQL puro. O termômetro do teto MEI NÃO mora aqui: é agregado
 * em EarningsStorage.monthlyRealizedForRange (mesmas fontes do extrato).
 */

const PROFILE_COLS =
  "id_user, is_mei, cnpj, provider_name, provider_doc, provider_address, das_reminder";
const RECEIPT_COLS =
  "id_receipt, number, taker_name, taker_doc, description, amount_cents, issued_for, source_kind, source_id, created_at";

async function getProfile(db, userId) {
  const r = await db.query(
    `SELECT ${PROFILE_COLS} FROM public.mei_profile WHERE id_user = $1`,
    [userId]
  );
  return r.rows[0] || null;
}

async function upsertProfile(db, userId, f) {
  const r = await db.query(
    `
    INSERT INTO public.mei_profile
      (id_user, is_mei, cnpj, provider_name, provider_doc, provider_address, das_reminder, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (id_user) DO UPDATE SET
      is_mei           = EXCLUDED.is_mei,
      cnpj             = EXCLUDED.cnpj,
      provider_name    = EXCLUDED.provider_name,
      provider_doc     = EXCLUDED.provider_doc,
      provider_address = EXCLUDED.provider_address,
      das_reminder     = EXCLUDED.das_reminder,
      updated_at       = NOW()
    RETURNING ${PROFILE_COLS}
    `,
    [
      userId,
      !!f.is_mei,
      f.cnpj || null,
      f.provider_name || null,
      f.provider_doc || null,
      f.provider_address || null,
      f.das_reminder !== false,
    ]
  );
  return r.rows[0];
}

async function listReceipts(db, userId, { limit = 20, offset = 0 }) {
  const [rows, count] = await Promise.all([
    db.query(
      `SELECT ${RECEIPT_COLS} FROM public.mei_receipt
        WHERE id_user = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    db.query(`SELECT COUNT(*)::int AS c FROM public.mei_receipt WHERE id_user = $1`, [userId]),
  ]);
  return { items: rows.rows, total: count.rows[0]?.c || 0 };
}

async function getReceipt(db, userId, id) {
  const r = await db.query(
    `SELECT ${RECEIPT_COLS} FROM public.mei_receipt WHERE id_user = $1 AND id_receipt = $2`,
    [userId, id]
  );
  return r.rows[0] || null;
}

async function createReceipt(db, userId, f) {
  // Numeração sequencial por usuário; o índice único (id_user, number) blinda
  // contra corrida (baixíssima concorrência por usuário).
  const r = await db.query(
    `
    INSERT INTO public.mei_receipt
      (id_user, number, taker_name, taker_doc, description, amount_cents, issued_for, source_kind, source_id)
    VALUES (
      $1,
      (SELECT COALESCE(MAX(number), 0) + 1 FROM public.mei_receipt WHERE id_user = $1),
      $2, $3, $4, $5, $6, $7, $8
    )
    RETURNING ${RECEIPT_COLS}
    `,
    [
      userId,
      f.taker_name,
      f.taker_doc || null,
      f.description,
      f.amount_cents,
      f.issued_for || null,
      f.source_kind || "manual",
      f.source_id || null,
    ]
  );
  return r.rows[0];
}

module.exports = {
  getProfile,
  upsertProfile,
  listReceipts,
  getReceipt,
  createReceipt,
};
