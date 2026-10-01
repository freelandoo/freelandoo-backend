// src/storages/ProductCollectionStorage.js
// Coleções da Loja (mig 271) — vitrine da dona, não taxonomia da plataforma.

const COLS = `id_collection, id_profile, name, slug, kicker, description, cover_url,
              sort_order, created_at, updated_at`;

class ProductCollectionStorage {
  static async listByProfile(conn, id_profile) {
    const r = await conn.query(
      `SELECT ${COLS},
              (SELECT COUNT(*)::int FROM public.tb_profile_product pp
                WHERE pp.id_collection = c.id_collection AND pp.deleted_at IS NULL) AS products_count
         FROM public.tb_profile_product_collection c
        WHERE c.id_profile = $1 AND c.deleted_at IS NULL
        ORDER BY c.sort_order ASC, c.id_collection ASC`,
      [id_profile]
    );
    return r.rows;
  }

  static async getById(conn, id_collection) {
    const r = await conn.query(
      `SELECT ${COLS}, cover_key FROM public.tb_profile_product_collection
        WHERE id_collection = $1 AND deleted_at IS NULL`,
      [id_collection]
    );
    return r.rows[0] || null;
  }

  static async slugTaken(conn, id_profile, slug, exceptId = null) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_profile_product_collection
        WHERE id_profile = $1 AND slug = $2 AND deleted_at IS NULL
          AND ($3::bigint IS NULL OR id_collection <> $3)
        LIMIT 1`,
      [id_profile, slug, exceptId]
    );
    return r.rowCount > 0;
  }

  static async nextSortOrder(conn, id_profile) {
    const r = await conn.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n
         FROM public.tb_profile_product_collection
        WHERE id_profile = $1 AND deleted_at IS NULL`,
      [id_profile]
    );
    return Number(r.rows[0]?.n) || 0;
  }

  static async create(conn, d) {
    const r = await conn.query(
      `INSERT INTO public.tb_profile_product_collection
         (id_profile, name, slug, kicker, description, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING ${COLS}`,
      [d.id_profile, d.name, d.slug, d.kicker || null, d.description || null, d.sort_order || 0]
    );
    return r.rows[0];
  }

  static async update(conn, id_collection, fields) {
    const allowed = ["name", "slug", "kicker", "description", "sort_order", "cover_url", "cover_key"];
    const sets = [];
    const values = [];
    let i = 1;
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) {
        sets.push(`${k} = $${i++}`);
        values.push(fields[k]);
      }
    }
    if (sets.length === 0) return this.getById(conn, id_collection);
    values.push(id_collection);
    const r = await conn.query(
      `UPDATE public.tb_profile_product_collection
          SET ${sets.join(", ")}, updated_at = NOW()
        WHERE id_collection = $${i} AND deleted_at IS NULL
        RETURNING ${COLS}`,
      values
    );
    return r.rows[0] || null;
  }

  /** Apagar a coleção SOLTA os produtos dela (eles continuam na Loja). */
  static async softDelete(conn, id_collection) {
    await conn.query(
      `UPDATE public.tb_profile_product SET id_collection = NULL, updated_at = NOW()
        WHERE id_collection = $1`,
      [id_collection]
    );
    const r = await conn.query(
      `UPDATE public.tb_profile_product_collection
          SET deleted_at = NOW(), updated_at = NOW()
        WHERE id_collection = $1 AND deleted_at IS NULL
        RETURNING id_collection`,
      [id_collection]
    );
    return r.rowCount > 0;
  }

  static async reorder(conn, id_profile, ids) {
    for (let i = 0; i < ids.length; i += 1) {
      await conn.query(
        `UPDATE public.tb_profile_product_collection
            SET sort_order = $3, updated_at = NOW()
          WHERE id_collection = $2 AND id_profile = $1 AND deleted_at IS NULL`,
        [id_profile, ids[i], i]
      );
    }
  }
}

module.exports = ProductCollectionStorage;
