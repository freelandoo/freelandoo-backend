// src/storages/CoursesStorage.js
// SQL puro para a tabela public.courses (migration 042).
// Convenção do projeto: nenhuma ORM, queries parametrizadas com $1, $2, ...

class CoursesStorage {
  // ----------------------------------------------------------------
  // Leitura
  // ----------------------------------------------------------------

  static async getById(conn, id) {
    const { rows } = await conn.query(
      `SELECT
         c.id,
         c.owner_user_id,
         c.profile_id,
         c.title,
         c.slug,
         c.short_description,
         c.description,
         c.cover_url,
         c.price_cents,
         c.status,
         c.feed_post_id,
         c.published_at,
         c.created_at,
         c.updated_at,
         COALESCE(mc.modules_count, 0)::int AS modules_count,
         COALESCE(lc.lessons_count, 0)::int AS lessons_count,
         COALESCE(ec.students_count, 0)::int AS students_count,
         COALESCE(ec.revenue_cents, 0)::int AS revenue_cents
       FROM public.courses c
       LEFT JOIN (
         SELECT course_id, COUNT(*) AS modules_count
           FROM public.course_modules
          WHERE course_id = $1
          GROUP BY course_id
       ) mc ON mc.course_id = c.id
       LEFT JOIN (
         SELECT course_id, COUNT(*) AS lessons_count
           FROM public.course_lessons
          WHERE course_id = $1
          GROUP BY course_id
       ) lc ON lc.course_id = c.id
       LEFT JOIN (
         SELECT
           course_id,
           COUNT(*) FILTER (WHERE status = 'active') AS students_count,
           SUM(amount_paid_cents) FILTER (WHERE status = 'active') AS revenue_cents
          FROM public.course_enrollments
         WHERE course_id = $1
         GROUP BY course_id
       ) ec ON ec.course_id = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [id],
    );
    return rows[0] || null;
  }

  static async getBySlug(conn, slug) {
    if (!slug) return null;
    const { rows } = await conn.query(
      `SELECT
         id, owner_user_id, profile_id, title, slug, short_description,
         description, cover_url, price_cents, status, feed_post_id,
         published_at, created_at, updated_at
       FROM public.courses
       WHERE slug = $1
       LIMIT 1`,
      [slug],
    );
    return rows[0] || null;
  }

  static async slugExists(conn, slug, { exceptId = null } = {}) {
    if (!slug) return false;
    const params = [slug];
    let sql = `SELECT 1 FROM public.courses WHERE slug = $1`;
    if (exceptId) {
      params.push(exceptId);
      sql += ` AND id <> $${params.length}`;
    }
    sql += ` LIMIT 1`;
    const { rowCount } = await conn.query(sql, params);
    return rowCount > 0;
  }

  static async listByOwner(conn, ownerUserId) {
    const { rows } = await conn.query(
      `SELECT
         c.id,
         c.owner_user_id,
         c.profile_id,
         c.title,
         c.slug,
         c.short_description,
         c.description,
         c.cover_url,
         c.price_cents,
         c.status,
         c.feed_post_id,
         c.published_at,
         c.created_at,
         c.updated_at,
         p.display_name AS profile_display_name,
         COALESCE(mc.modules_count, 0)::int AS modules_count,
         COALESCE(lc.lessons_count, 0)::int AS lessons_count,
         COALESCE(ec.students_count, 0)::int AS students_count,
         COALESCE(ec.revenue_cents, 0)::int AS revenue_cents
       FROM public.courses c
       LEFT JOIN public.tb_profile p ON p.id_profile = c.profile_id
       LEFT JOIN (
         SELECT course_id, COUNT(*) AS modules_count
           FROM public.course_modules
          GROUP BY course_id
       ) mc ON mc.course_id = c.id
       LEFT JOIN (
         SELECT course_id, COUNT(*) AS lessons_count
           FROM public.course_lessons
          GROUP BY course_id
       ) lc ON lc.course_id = c.id
       LEFT JOIN (
         SELECT
           course_id,
           COUNT(*) FILTER (WHERE status = 'active') AS students_count,
           SUM(amount_paid_cents) FILTER (WHERE status = 'active') AS revenue_cents
          FROM public.course_enrollments
         GROUP BY course_id
       ) ec ON ec.course_id = c.id
       WHERE c.owner_user_id = $1
       ORDER BY c.created_at DESC`,
      [ownerUserId],
    );
    return rows;
  }

  // ----------------------------------------------------------------
  // Escrita
  // ----------------------------------------------------------------

  static async create(
    conn,
    {
      ownerUserId,
      profileId = null,
      title,
      slug = null,
      shortDescription = null,
      description = null,
      coverUrl = null,
      priceCents = null,
    },
  ) {
    const { rows } = await conn.query(
      `INSERT INTO public.courses (
         owner_user_id,
         profile_id,
         title,
         slug,
         short_description,
         description,
         cover_url,
         price_cents,
         status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')
       RETURNING *`,
      [
        ownerUserId,
        profileId,
        title,
        slug,
        shortDescription,
        description,
        coverUrl,
        priceCents,
      ],
    );
    return rows[0];
  }

  /**
   * Atualização dinâmica. Recebe um dicionário { col: valor } e gera o SET ...
   * Aceita apenas colunas seguras (whitelist).
   */
  static async updateById(conn, id, patch) {
    const allowed = new Set([
      "title",
      "slug",
      "short_description",
      "description",
      "cover_url",
      "price_cents",
      "status",
      "profile_id",
      "feed_post_id",
      "published_at",
    ]);

    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(patch || {})) {
      if (!allowed.has(key)) continue;
      params.push(value);
      sets.push(`${key} = $${params.length}`);
    }

    if (!sets.length) {
      return this.getById(conn, id);
    }

    params.push(id);
    const { rows } = await conn.query(
      `UPDATE public.courses
         SET ${sets.join(", ")}
       WHERE id = $${params.length}
       RETURNING *`,
      params,
    );
    return rows[0] || null;
  }

  static async deleteById(conn, id) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.courses WHERE id = $1`,
      [id],
    );
    return rowCount > 0;
  }
}

module.exports = CoursesStorage;
