const pool = require("../databases");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("MeOfferingsService");

/**
 * Lista agregada de produtos / serviços / cursos do usuário autenticado.
 * Usado no /mensagens pra anexar um item dentro do chat (O.S. ou privada).
 * Cada item já vem com `public_url` pronta pra inserir como link.
 */
class MeOfferingsService {
  static async list(user, payload = {}) {
    return runWithLogs(
      log,
      "list",
      () => ({ id_user: user?.id_user, type: payload?.type }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const typeRaw = String(payload.type || "all").toLowerCase();
        const wantsProducts = typeRaw === "all" || typeRaw === "products";
        const wantsServices = typeRaw === "all" || typeRaw === "services";
        const wantsCourses = typeRaw === "all" || typeRaw === "courses";

        const result = { products: [], services: [], courses: [] };

        if (wantsProducts) {
          const { rows } = await pool.query(
            `SELECT
               pp.id_profile_product AS id,
               pp.id_profile,
               pp.name,
               pp.description,
               pp.price_amount        AS price_cents,
               pp.is_active,
               p.display_name         AS profile_display_name,
               p.sub_profile_slug,
               u.username,
               (
                 SELECT media_url FROM public.tb_profile_product_media m
                  WHERE m.id_profile_product = pp.id_profile_product
                    AND m.deleted_at IS NULL
                  ORDER BY m.created_at ASC LIMIT 1
               ) AS image_url
             FROM public.tb_profile_product pp
             JOIN public.tb_profile p ON p.id_profile = pp.id_profile
             JOIN public.tb_user u    ON u.id_user = p.id_user
             WHERE p.id_user = $1
               AND pp.deleted_at IS NULL
               AND p.deleted_at IS NULL
             ORDER BY pp.created_at DESC`,
            [user.id_user]
          );
          result.products = rows.map((r) => ({
            id: r.id,
            id_profile: r.id_profile,
            kind: "product",
            name: r.name,
            description: r.description,
            price_cents: r.price_cents,
            is_active: r.is_active,
            image_url: r.image_url,
            profile_display_name: r.profile_display_name,
            sub_profile_slug: r.sub_profile_slug,
            username: r.username,
            public_url: `/p/${r.id_profile}/produto/${r.id}`,
          }));
        }

        if (wantsServices) {
          const { rows } = await pool.query(
            `SELECT
               ps.id_profile_service AS id,
               ps.id_profile,
               ps.name,
               ps.description,
               ps.duration_minutes,
               ps.price_amount        AS price_cents,
               ps.is_active,
               p.display_name         AS profile_display_name,
               p.sub_profile_slug,
               u.username
             FROM public.tb_profile_service ps
             JOIN public.tb_profile p ON p.id_profile = ps.id_profile
             JOIN public.tb_user u    ON u.id_user = p.id_user
             WHERE p.id_user = $1
               AND ps.deleted_at IS NULL
               AND p.deleted_at IS NULL
             ORDER BY ps.created_at DESC`,
            [user.id_user]
          );
          result.services = rows.map((r) => ({
            id: r.id,
            id_profile: r.id_profile,
            kind: "service",
            name: r.name,
            description: r.description,
            duration_minutes: r.duration_minutes,
            price_cents: r.price_cents,
            is_active: r.is_active,
            profile_display_name: r.profile_display_name,
            sub_profile_slug: r.sub_profile_slug,
            username: r.username,
            public_url: `/freelancer/${r.id_profile}`,
          }));
        }

        if (wantsCourses) {
          const { rows } = await pool.query(
            `SELECT
               c.id,
               c.title,
               c.slug,
               c.short_description,
               c.cover_url,
               c.price_cents,
               c.status,
               c.published_at,
               p.display_name AS profile_display_name,
               u.username
             FROM public.courses c
             LEFT JOIN public.tb_profile p ON p.id_profile = c.profile_id
             LEFT JOIN public.tb_user u    ON u.id_user = c.owner_user_id
             WHERE c.owner_user_id = $1
             ORDER BY c.created_at DESC`,
            [user.id_user]
          );
          result.courses = rows.map((r) => ({
            id: r.id,
            kind: "course",
            name: r.title,
            description: r.short_description,
            price_cents: r.price_cents,
            image_url: r.cover_url,
            slug: r.slug,
            status: r.status,
            published: !!r.published_at,
            profile_display_name: r.profile_display_name,
            username: r.username,
            public_url: r.slug ? `/cursos/${r.slug}` : `/cursos/${r.id}`,
          }));
        }

        return result;
      }
    );
  }
}

module.exports = MeOfferingsService;
