// src/services/CoursesService.js
// Regras de negócio dos cursos (Slice 2).
//
// Decisões:
// - Qualquer usuário logado pode criar curso (sem dependência de assinatura).
// - Curso nasce em status='draft'.
// - Para publicar (status='published'): title obrigatório + price_cents >= 500.
// - Slug é gerado automaticamente a partir do title e desambiguado (foo, foo-2, foo-3).
// - profile_id é opcional; quando informado precisa pertencer ao próprio user.
// - Apenas o owner_user_id pode editar/pausar/excluir.

const pool = require("../databases");
const CoursesStorage = require("../storages/CoursesStorage");
const CourseFeedPostsStorage = require("../storages/CourseFeedPostsStorage");
const StripeService = require("./StripeService");
const uploadCourseImageToR2 = require("../integrations/r2/uploadCourseImageToR2");
const { assertMinorPermission } = require("../utils/supervision");
const { slugify } = require("../utils/slug");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CoursesService");

const MIN_PUBLISH_PRICE_CENTS = 500;
const TITLE_MAX_LEN = 160;
const SHORT_DESC_MAX_LEN = 280;
const DESC_MAX_LEN = 20000;
const COVER_URL_MAX_LEN = 1024;

function sanitizeText(value, maxLen) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

function parsePriceCents(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return Math.floor(n);
}

function normalizeStatus(value) {
  const s = String(value || "").toLowerCase();
  return ["draft", "published", "paused"].includes(s) ? s : null;
}

async function ensureUniqueSlug(conn, base, exceptId = null) {
  const root = slugify(base) || "curso";
  let candidate = root.slice(0, 80);
  let suffix = 1;
  // Tenta o slug "puro" primeiro; se colidir, vai pra -2, -3, ...
  // Hard cap em 100 tentativas para não loopar em catástrofe.
  while (await CoursesStorage.slugExists(conn, candidate, { exceptId })) {
    suffix += 1;
    candidate = `${root.slice(0, 80 - String(suffix).length - 1)}-${suffix}`;
    if (suffix > 100) {
      candidate = `${root.slice(0, 70)}-${Date.now().toString(36)}`;
      break;
    }
  }
  return candidate;
}

async function profileBelongsToUser(conn, profileId, userId) {
  if (!profileId) return true;
  const { rows } = await conn.query(
    `SELECT id_user FROM public.tb_profile WHERE id_profile = $1 LIMIT 1`,
    [profileId],
  );
  if (!rows.length) return false;
  return rows[0].id_user === userId;
}

function publicCourseShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    profile_id: row.profile_id || null,
    profile_display_name: row.profile_display_name || null,
    title: row.title,
    slug: row.slug,
    short_description: row.short_description,
    description: row.description,
    cover_url: row.cover_url,
    price_cents: row.price_cents,
    status: row.status,
    feed_post_id: row.feed_post_id || null,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // modules_count populado pelo storage via JOIN (Slice 4).
    // lessons_count populado pelo storage via JOIN (Slice 5).
    modules_count: row.modules_count ?? 0,
    lessons_count: row.lessons_count ?? 0,
    students_count: row.students_count ?? 0,
    revenue_cents: row.revenue_cents ?? 0,
  };
}

class CoursesService {
  // --------------------------------------------------------------
  // Listagens
  // --------------------------------------------------------------

  static async listMine(user) {
    return runWithLogs(
      log,
      "listMine",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const rows = await CoursesStorage.listByOwner(pool, user.id_user);
        return { courses: rows.map(publicCourseShape) };
      },
    );
  }

  /**
   * Cria sessão Stripe one-time para comprar um curso publicado.
   * - Bloqueia se user é dono do curso ou já tem enrollment ativo.
   * - metadata.type='course_purchase' → webhook chama confirmStripeSession.
   */
  static async createStripeCheckout(user, courseId, body = {}) {
    return runWithLogs(
      log,
      "createStripeCheckout",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!courseId) return { error: "course_id inválido" };
        const course = await CoursesStorage.getById(pool, courseId);
        if (!course) return { error: "Curso não encontrado", status: 404 };
        if (course.status !== "published") {
          return { error: "Curso não está publicado", status: 400 };
        }
        if (course.owner_user_id === user.id_user) {
          return { error: "Você é o dono deste curso", status: 400 };
        }
        const already = await CoursesStorage.hasActiveEnrollment(
          pool,
          courseId,
          user.id_user,
        );
        if (already) {
          return { error: "Você já tem acesso a este curso", status: 400 };
        }
        const amount = Number(course.price_cents) || 0;
        if (amount <= 0) {
          return { error: "Curso sem preço configurado", status: 400 };
        }

        const frontend = String(
          process.env.FRONTEND_URL || "https://freelandoo.com",
        ).replace(/\/$/, "");

        const session = await StripeService.createOneTimeCheckoutSession({
          amount_cents: amount,
          currency: "BRL",
          productName: `Curso - ${course.title}`,
          customerEmail: user.email || undefined,
          clientReferenceId: user.id_user,
          successUrl: `${frontend}/cursos/${course.slug}?course_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${frontend}/cursos/${course.slug}?course_checkout=cancel`,
          metadata: {
            type: "course_purchase",
            user_id: user.id_user,
            course_id: course.id,
            amount_cents: String(amount),
            ...(body?.coupon_code ? { coupon_code: String(body.coupon_code).trim().toUpperCase().slice(0, 40) } : {}),
          },
        });
        return { checkout_url: session.url, session_id: session.id };
      },
    );
  }

  /**
   * Confirma uma sessão Stripe com metadata.type='course_purchase'.
   * Idempotente via UNIQUE(course_id, user_id) em course_enrollments.
   */
  static async confirmStripeSession(session) {
    const meta = session?.metadata || {};
    if (meta.type !== "course_purchase") return { ignored: true };
    const courseId = meta.course_id;
    const userId = meta.user_id;
    const amount = Number(meta.amount_cents) || 0;
    if (!courseId || !userId) {
      return { error: "Metadata inválido" };
    }
    const enrollment = await CoursesStorage.upsertEnrollment(pool, {
      courseId,
      userId,
      amountCents: amount,
      currency: "BRL",
    });
    return { enrollment };
  }

  /**
   * Lista cursos publicados vinculados a um subperfil. Sem auth.
   */
  static async listPublicByProfile(profileId) {
    return runWithLogs(
      log,
      "listPublicByProfile",
      () => ({ profileId }),
      async () => {
        if (!profileId) return { error: "profileId inválido" };
        const rows = await CoursesStorage.listPublicByProfileId(pool, profileId);
        return { courses: rows.map(publicCourseShape) };
      },
    );
  }

  /**
   * Visão pública do curso por slug. Só retorna se status='published'.
   * Sem auth — usada no link de "curso vinculado" do subperfil.
   */
  static async getPublicBySlug(slug) {
    return runWithLogs(
      log,
      "getPublicBySlug",
      () => ({ slug }),
      async () => {
        const normalized = String(slug || "").trim().toLowerCase();
        if (!normalized) return { error: "slug inválido" };
        const row = await CoursesStorage.getBySlug(pool, normalized);
        if (!row) return { error: "Curso não encontrado", status: 404 };
        if (row.status !== "published") {
          return { error: "Curso não está publicado", status: 404 };
        }
        return { course: publicCourseShape(row) };
      },
    );
  }

  static async getMineById(user, courseId) {
    return runWithLogs(
      log,
      "getMineById",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!courseId) return { error: "ID inválido" };
        const row = await CoursesStorage.getById(pool, courseId);
        if (!row) return { error: "Curso não encontrado" };
        if (row.owner_user_id !== user.id_user) {
          return { error: "Sem permissão para acessar este curso" };
        }
        return { course: publicCourseShape(row) };
      },
    );
  }

  // --------------------------------------------------------------
  // Mutações
  // --------------------------------------------------------------

  static async create(user, body = {}) {
    return runWithLogs(
      log,
      "create",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const minorBlock = await assertMinorPermission(user.id_user, "can_sell_courses");
        if (minorBlock) return minorBlock;

        const title = sanitizeText(body.title, TITLE_MAX_LEN);
        if (!title) return { error: "Título é obrigatório" };

        const shortDescription = sanitizeText(
          body.short_description,
          SHORT_DESC_MAX_LEN,
        );
        const description = sanitizeText(body.description, DESC_MAX_LEN);
        const coverUrl = sanitizeText(body.cover_url, COVER_URL_MAX_LEN);
        const priceCents = parsePriceCents(body.price_cents);

        const profileId =
          typeof body.profile_id === "string" && body.profile_id.trim()
            ? body.profile_id.trim()
            : null;

        const client = await pool.connect();
        try {
          if (!(await profileBelongsToUser(client, profileId, user.id_user))) {
            return { error: "Perfil informado é inválido" };
          }
          const slug = await ensureUniqueSlug(client, title);
          const created = await CoursesStorage.create(client, {
            ownerUserId: user.id_user,
            profileId,
            title,
            slug,
            shortDescription,
            description,
            coverUrl,
            priceCents,
          });
          return { course: publicCourseShape(created) };
        } finally {
          client.release();
        }
      },
    );
  }

  static async update(user, courseId, body = {}) {
    return runWithLogs(
      log,
      "update",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!courseId) return { error: "ID inválido" };

        const client = await pool.connect();
        try {
          const existing = await CoursesStorage.getById(client, courseId);
          if (!existing) return { error: "Curso não encontrado" };
          if (existing.owner_user_id !== user.id_user) {
            return { error: "Sem permissão para editar este curso" };
          }

          const patch = {};

          if (body.title !== undefined) {
            const title = sanitizeText(body.title, TITLE_MAX_LEN);
            if (!title) return { error: "Título é obrigatório" };
            patch.title = title;
            // Se o título mudou e o curso ainda está em draft, refresca o slug.
            // Cursos já publicados mantêm o slug atual (não quebra link público).
            if (existing.status === "draft" && title !== existing.title) {
              patch.slug = await ensureUniqueSlug(client, title, courseId);
            }
          }

          if (body.short_description !== undefined) {
            patch.short_description = sanitizeText(
              body.short_description,
              SHORT_DESC_MAX_LEN,
            );
          }
          if (body.description !== undefined) {
            patch.description = sanitizeText(body.description, DESC_MAX_LEN);
          }
          if (body.cover_url !== undefined) {
            patch.cover_url = sanitizeText(body.cover_url, COVER_URL_MAX_LEN);
          }
          if (body.price_cents !== undefined) {
            patch.price_cents = parsePriceCents(body.price_cents);
          }
          if (body.profile_id !== undefined) {
            const profileId =
              typeof body.profile_id === "string" && body.profile_id.trim()
                ? body.profile_id.trim()
                : null;
            if (
              !(await profileBelongsToUser(client, profileId, user.id_user))
            ) {
              return { error: "Perfil informado é inválido" };
            }
            patch.profile_id = profileId;
          }

          if (body.status !== undefined) {
            const next = normalizeStatus(body.status);
            if (!next) return { error: "Status inválido" };

            // Validações de publicação
            if (next === "published") {
              const titleFinal = patch.title ?? existing.title;
              const priceFinal =
                patch.price_cents !== undefined
                  ? patch.price_cents
                  : existing.price_cents;

              if (!titleFinal || !sanitizeText(titleFinal, TITLE_MAX_LEN)) {
                return { error: "Título obrigatório para publicar" };
              }
              if (priceFinal == null) {
                return { error: "Preço obrigatório para publicar" };
              }
              if (priceFinal < MIN_PUBLISH_PRICE_CENTS) {
                return {
                  error: `Preço mínimo para publicar é R$ ${(MIN_PUBLISH_PRICE_CENTS / 100).toFixed(2)}`,
                };
              }
              patch.status = "published";
              if (!existing.published_at) {
                patch.published_at = new Date().toISOString();
              }
            } else {
              patch.status = next;
            }
          }

          const updated = await CoursesStorage.updateById(
            client,
            courseId,
            patch,
          );
          return { course: publicCourseShape(updated) };
        } finally {
          client.release();
        }
      },
    );
  }

  // --------------------------------------------------------------
  // Upload da capa do curso (banner hero da landing). Multipart, R2.
  // Mantém a coluna cover_url já existente; só altera o transporte
  // de URL crua → upload direto pelo dono.
  // --------------------------------------------------------------

  static async uploadCover(user, courseId, file) {
    return runWithLogs(
      log,
      "uploadCover",
      () => ({
        id_user: user?.id_user,
        course_id: courseId,
        size: file?.size,
        mimetype: file?.mimetype,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!courseId) return { error: "ID do curso inválido" };
        if (!file?.buffer?.length) return { error: "Arquivo não enviado" };

        const existing = await CoursesStorage.getById(pool, courseId);
        if (!existing) return { error: "Curso não encontrado" };
        if (existing.owner_user_id !== user.id_user) {
          return { error: "Sem permissão para editar este curso" };
        }

        let url;
        try {
          url = await uploadCourseImageToR2({
            file,
            kind: "course-cover",
            courseId,
            resourceId: courseId,
          });
        } catch (err) {
          return { error: err?.message || "Falha ao enviar capa" };
        }

        const updated = await CoursesStorage.updateById(pool, courseId, {
          cover_url: url,
        });
        return { course: publicCourseShape(updated) };
      },
    );
  }

  static async removeCover(user, courseId) {
    return runWithLogs(
      log,
      "removeCover",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!courseId) return { error: "ID do curso inválido" };

        const existing = await CoursesStorage.getById(pool, courseId);
        if (!existing) return { error: "Curso não encontrado" };
        if (existing.owner_user_id !== user.id_user) {
          return { error: "Sem permissão para editar este curso" };
        }

        const updated = await CoursesStorage.updateById(pool, courseId, {
          cover_url: null,
        });
        return { course: publicCourseShape(updated) };
      },
    );
  }

  static async remove(user, courseId) {
    return runWithLogs(
      log,
      "remove",
      () => ({ id_user: user?.id_user, course_id: courseId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!courseId) return { error: "ID inválido" };

        const existing = await CoursesStorage.getById(pool, courseId);
        if (!existing) return { error: "Curso não encontrado" };
        if (existing.owner_user_id !== user.id_user) {
          return { error: "Sem permissão para excluir este curso" };
        }
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          if (existing.feed_post_id) {
            await CourseFeedPostsStorage.archivePortfolioItem(
              client,
              existing.feed_post_id,
              user.id_user,
            );
          }
          const ok = await CoursesStorage.deleteById(client, courseId);
          await client.query("COMMIT");
          return { deleted: ok };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
    );
  }
}

module.exports = CoursesService;
