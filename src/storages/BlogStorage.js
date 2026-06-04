// Storage do blog (SQL puro). Camada de dados de blog_posts (mig 114).

const PUBLIC_FIELDS = `
  id, slug, title, excerpt, cover_url, cover_alt, body_md, category, tags,
  status, reading_minutes, seo_title, seo_description, author_name, views,
  published_at, created_at, updated_at
`;

class BlogStorage {
  // ───────────────────────── Público ─────────────────────────
  static async listPublished(conn, { limit = 24, offset = 0, category = null } = {}) {
    const where = ["status = 'published'", "published_at IS NOT NULL", "published_at <= NOW()"];
    const params = [];
    let i = 0;
    if (category) {
      where.push(`category = $${++i}`);
      params.push(category);
    }
    params.push(limit, offset);
    const { rows } = await conn.query(
      `SELECT id, slug, title, excerpt, cover_url, cover_alt, category, tags,
              reading_minutes, author_name, published_at
         FROM public.blog_posts
        WHERE ${where.join(" AND ")}
        ORDER BY published_at DESC
        LIMIT $${i + 1} OFFSET $${i + 2}`,
      params
    );
    return rows;
  }

  static async countPublished(conn, { category = null } = {}) {
    const where = ["status = 'published'", "published_at IS NOT NULL", "published_at <= NOW()"];
    const params = [];
    if (category) {
      where.push(`category = $1`);
      params.push(category);
    }
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS total FROM public.blog_posts WHERE ${where.join(" AND ")}`,
      params
    );
    return rows[0]?.total || 0;
  }

  static async getPublishedBySlug(conn, slug) {
    const { rows } = await conn.query(
      `SELECT ${PUBLIC_FIELDS}
         FROM public.blog_posts
        WHERE slug = $1 AND status = 'published'
          AND published_at IS NOT NULL AND published_at <= NOW()
        LIMIT 1`,
      [slug]
    );
    return rows[0] || null;
  }

  // Retorna por slug em qualquer status (publicado ou rascunho). Permite que o
  // admin abra/edite um rascunho pela URL pública direta — mesmo padrão dos
  // participantes da Casa Views (abrir inativo por link direto). A página marca
  // noindex quando não está publicado.
  static async getAnyBySlug(conn, slug) {
    const { rows } = await conn.query(
      `SELECT ${PUBLIC_FIELDS} FROM public.blog_posts WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    return rows[0] || null;
  }

  static async listPublishedCategories(conn) {
    const { rows } = await conn.query(
      `SELECT category, COUNT(*)::int AS total
         FROM public.blog_posts
        WHERE status = 'published' AND category IS NOT NULL
          AND published_at IS NOT NULL AND published_at <= NOW()
        GROUP BY category
        ORDER BY category ASC`
    );
    return rows;
  }

  static async listRelated(conn, { slug, category, limit = 3 }) {
    const { rows } = await conn.query(
      `SELECT slug, title, excerpt, cover_url, cover_alt, category, reading_minutes, published_at
         FROM public.blog_posts
        WHERE status = 'published' AND slug <> $1
          AND published_at IS NOT NULL AND published_at <= NOW()
          AND ($2::text IS NULL OR category = $2)
        ORDER BY published_at DESC
        LIMIT $3`,
      [slug, category || null, limit]
    );
    return rows;
  }

  static async incrementViews(conn, slug) {
    await conn.query(
      `UPDATE public.blog_posts SET views = views + 1 WHERE slug = $1 AND status = 'published'`,
      [slug]
    );
  }

  static async listPublishedSlugs(conn) {
    const { rows } = await conn.query(
      `SELECT slug, updated_at FROM public.blog_posts
        WHERE status = 'published' AND published_at IS NOT NULL AND published_at <= NOW()
        ORDER BY published_at DESC`
    );
    return rows;
  }

  // ───────────────────────── Admin ─────────────────────────
  static async listAdmin(conn, { status = null, q = null, limit = 100, offset = 0 } = {}) {
    const where = [];
    const params = [];
    let i = 0;
    if (status) {
      where.push(`status = $${++i}`);
      params.push(status);
    }
    if (q) {
      where.push(`(title ILIKE $${++i} OR slug ILIKE $${i})`);
      params.push(`%${q}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    params.push(limit, offset);
    const { rows } = await conn.query(
      `SELECT id, slug, title, excerpt, cover_url, category, tags, status,
              reading_minutes, author_name, views, published_at, created_at, updated_at
         FROM public.blog_posts
         ${whereSql}
        ORDER BY COALESCE(published_at, created_at) DESC
        LIMIT $${i + 1} OFFSET $${i + 2}`,
      params
    );
    return rows;
  }

  static async getById(conn, id) {
    const { rows } = await conn.query(
      `SELECT * FROM public.blog_posts WHERE id = $1 LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  static async slugExists(conn, slug, exceptId = null) {
    const { rows } = await conn.query(
      `SELECT 1 FROM public.blog_posts WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2) LIMIT 1`,
      [slug, exceptId]
    );
    return rows.length > 0;
  }

  static async create(conn, data) {
    const {
      slug, title, excerpt = null, cover_url = null, cover_alt = null,
      body_md = "", category = null, tags = [], status = "draft",
      reading_minutes = 1, seo_title = null, seo_description = null,
      author_name = "Equipe Freelandoo", published_at = null, created_by = null,
    } = data;
    const { rows } = await conn.query(
      `INSERT INTO public.blog_posts (
         slug, title, excerpt, cover_url, cover_alt, body_md, category, tags,
         status, reading_minutes, seo_title, seo_description, author_name,
         published_at, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
       RETURNING *`,
      [
        slug, title, excerpt, cover_url, cover_alt, body_md, category, tags,
        status, reading_minutes, seo_title, seo_description, author_name,
        published_at, created_by,
      ]
    );
    return rows[0];
  }

  static async update(conn, id, patch, updated_by = null) {
    const allowed = [
      "slug", "title", "excerpt", "cover_url", "cover_alt", "body_md",
      "category", "tags", "status", "reading_minutes", "seo_title",
      "seo_description", "author_name", "published_at",
    ];
    const sets = [];
    const params = [];
    let i = 0;
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        sets.push(`${key} = $${++i}`);
        params.push(patch[key]);
      }
    }
    sets.push(`updated_by = $${++i}`);
    params.push(updated_by);
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rows } = await conn.query(
      `UPDATE public.blog_posts SET ${sets.join(", ")} WHERE id = $${i + 1} RETURNING *`,
      params
    );
    return rows[0] || null;
  }

  static async remove(conn, id) {
    const { rows } = await conn.query(
      `DELETE FROM public.blog_posts WHERE id = $1 RETURNING id`,
      [id]
    );
    return rows[0] || null;
  }
}

module.exports = BlogStorage;
