// Storage da LOJA GLOBAL "Conveniência Views" — produtos únicos (espelhados em
// todas as páginas de participante) + galeria de mídia. SQL puro.

const COLS = `
  id, name, description, image_url, price_cents, stock, is_active, sort_order, created_at, updated_at
`;

async function listProducts(conn, { onlyActive = false } = {}) {
  const where = onlyActive ? "WHERE is_active = TRUE" : "";
  const { rows } = await conn.query(
    `SELECT ${COLS} FROM public.casa_store_product ${where} ORDER BY sort_order ASC, created_at ASC`
  );
  return rows;
}

async function listProductsWithMedia(conn, { onlyActive = false } = {}) {
  const products = await listProducts(conn, { onlyActive });
  if (!products.length) return products;
  const ids = products.map((p) => p.id);
  const { rows: media } = await conn.query(
    `SELECT id, id_product, media_url, media_type, thumbnail_url, sort_order
       FROM public.casa_store_product_media
      WHERE id_product = ANY($1::uuid[])
      ORDER BY sort_order ASC, created_at ASC`,
    [ids]
  );
  const byProduct = new Map();
  for (const m of media) {
    if (!byProduct.has(m.id_product)) byProduct.set(m.id_product, []);
    byProduct.get(m.id_product).push(m);
  }
  return products.map((p) => ({ ...p, media: byProduct.get(p.id) || [] }));
}

async function getProductById(conn, id) {
  const { rows } = await conn.query(`SELECT ${COLS} FROM public.casa_store_product WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] || null;
}

async function getProductWithMedia(conn, id) {
  const product = await getProductById(conn, id);
  if (!product) return null;
  const { rows: media } = await conn.query(
    `SELECT id, id_product, media_url, media_type, thumbnail_url, sort_order
       FROM public.casa_store_product_media WHERE id_product = $1 ORDER BY sort_order ASC, created_at ASC`,
    [id]
  );
  return { ...product, media };
}

async function createProduct(conn, d) {
  const { rows } = await conn.query(
    `INSERT INTO public.casa_store_product (name, description, image_url, price_cents, stock, is_active, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLS}`,
    [d.name, d.description, d.image_url, d.price_cents ?? 0, d.stock ?? null, d.is_active ?? true, d.sort_order ?? 0]
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
    `UPDATE public.casa_store_product SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${i} RETURNING ${COLS}`,
    vals
  );
  return rows[0] || null;
}

// Soft delete (não quebra FK de pedidos).
async function deleteProduct(conn, id) {
  const { rows } = await conn.query(
    `UPDATE public.casa_store_product SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING ${COLS}`,
    [id]
  );
  return rows[0] || null;
}

async function reserveStock(conn, id) {
  const { rows } = await conn.query(
    `UPDATE public.casa_store_product
        SET stock = CASE WHEN stock IS NULL THEN NULL ELSE stock - 1 END, updated_at = NOW()
      WHERE id = $1 AND (stock IS NULL OR stock > 0) RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

async function restoreStock(conn, id) {
  await conn.query(
    `UPDATE public.casa_store_product
        SET stock = CASE WHEN stock IS NULL THEN NULL ELSE stock + 1 END, updated_at = NOW() WHERE id = $1`,
    [id]
  );
}

// ─── Mídia ───
async function listMedia(conn, id_product) {
  const { rows } = await conn.query(
    `SELECT id, id_product, media_url, media_type, thumbnail_url, sort_order
       FROM public.casa_store_product_media WHERE id_product = $1 ORDER BY sort_order ASC, created_at ASC`,
    [id_product]
  );
  return rows;
}

async function addMedia(conn, d) {
  const { rows } = await conn.query(
    `INSERT INTO public.casa_store_product_media (id_product, media_url, media_type, thumbnail_url, sort_order)
     VALUES ($1,$2,$3,$4, COALESCE((SELECT MAX(sort_order)+1 FROM public.casa_store_product_media WHERE id_product=$1), 0))
     RETURNING id, id_product, media_url, media_type, thumbnail_url, sort_order`,
    [d.id_product, d.media_url, d.media_type ?? "image", d.thumbnail_url ?? null]
  );
  return rows[0] || null;
}

async function deleteMedia(conn, id) {
  const { rows } = await conn.query(
    `DELETE FROM public.casa_store_product_media WHERE id = $1 RETURNING id_product`,
    [id]
  );
  return rows[0]?.id_product || null;
}

async function reorderMedia(conn, id_product, orderedIds) {
  for (let i = 0; i < orderedIds.length; i++) {
    await conn.query(
      `UPDATE public.casa_store_product_media SET sort_order = $1 WHERE id = $2 AND id_product = $3`,
      [i, orderedIds[i], id_product]
    );
  }
}

// Recalcula a capa (image_url) = 1ª mídia (sort_order menor) ou null.
async function refreshCover(conn, id_product) {
  await conn.query(
    `UPDATE public.casa_store_product p
        SET image_url = (
          SELECT media_url FROM public.casa_store_product_media m
           WHERE m.id_product = $1 ORDER BY sort_order ASC, created_at ASC LIMIT 1
        ), updated_at = NOW()
      WHERE p.id = $1`,
    [id_product]
  );
}

module.exports = {
  listProducts, listProductsWithMedia, getProductById, getProductWithMedia,
  createProduct, updateProduct, deleteProduct, reserveStock, restoreStock,
  listMedia, addMedia, deleteMedia, reorderMedia, refreshCover,
};
