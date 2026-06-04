// Regras de negócio do Blog (mig 114).
// Público: listagem + post por slug (com related + view count).
// Admin: CRUD completo + upload de capa (R2) + publicar/despublicar.

const pool = require("../databases");
const BlogStorage = require("../storages/BlogStorage");
const uploadBlogCoverToR2 = require("../integrations/r2/uploadBlogCover");
const { slugify } = require("../utils/slug");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("BlogService");

const TITLE_MAX = 180;
const EXCERPT_MAX = 320;
const SEO_TITLE_MAX = 70;
const SEO_DESC_MAX = 180;
const BODY_MAX = 60000;

function sanitize(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

function readingMinutes(bodyMd) {
  const words = String(bodyMd || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    if (typeof tags === "string" && tags.trim()) {
      tags = tags.split(",");
    } else {
      return [];
    }
  }
  return [...new Set(
    tags.map((t) => String(t).trim().toLowerCase()).filter((t) => t && t.length <= 40)
  )].slice(0, 12);
}

async function ensureUniqueSlug(conn, base, exceptId = null) {
  const root = slugify(base) || "post";
  let candidate = root.slice(0, 90);
  let suffix = 1;
  while (await BlogStorage.slugExists(conn, candidate, exceptId)) {
    suffix += 1;
    candidate = `${root.slice(0, 90 - String(suffix).length - 1)}-${suffix}`;
    if (suffix > 100) {
      candidate = `${root.slice(0, 80)}-${Date.now().toString(36)}`;
      break;
    }
  }
  return candidate;
}

class BlogService {
  // ───────────────────────── Público ─────────────────────────
  static async listPublic({ page = 1, per_page = 12, category = null } = {}) {
    return runWithLogs(log, "listPublic", () => ({ page, category }), async () => {
      const pp = Math.min(Math.max(Number(per_page) || 12, 1), 48);
      const pg = Math.max(Number(page) || 1, 1);
      const offset = (pg - 1) * pp;
      const cat = category ? String(category).trim() : null;
      const [posts, total, categories] = await Promise.all([
        BlogStorage.listPublished(pool, { limit: pp, offset, category: cat }),
        BlogStorage.countPublished(pool, { category: cat }),
        BlogStorage.listPublishedCategories(pool),
      ]);
      return { posts, total, page: pg, per_page: pp, categories };
    });
  }

  static async getPublicBySlug(slug) {
    return runWithLogs(log, "getPublicBySlug", () => ({ slug }), async () => {
      const normalized = String(slug || "").trim().toLowerCase();
      if (!normalized) return { error: "slug inválido" };
      // Qualquer status: rascunho abre por link direto (admin edita inline).
      const post = await BlogStorage.getAnyBySlug(pool, normalized);
      if (!post) return { error: "Post não encontrado", statusCode: 404 };
      const related = await BlogStorage.listRelated(pool, {
        slug: normalized,
        category: post.category,
        limit: 3,
      });
      // View count só para publicados, fire-and-forget.
      if (post.status === "published") {
        BlogStorage.incrementViews(pool, normalized).catch(() => {});
      }
      return { post, related };
    });
  }

  static async listPublishedSlugs() {
    return BlogStorage.listPublishedSlugs(pool);
  }

  // ───────────────────────── Admin ─────────────────────────
  static async adminList(user, query = {}) {
    return runWithLogs(log, "adminList", () => ({ id_user: user?.id_user }), async () => {
      const posts = await BlogStorage.listAdmin(pool, {
        status: query.status ? String(query.status) : null,
        q: query.q ? String(query.q) : null,
        limit: Math.min(Math.max(Number(query.limit) || 100, 1), 200),
        offset: Math.max(Number(query.offset) || 0, 0),
      });
      return { posts };
    });
  }

  static async adminGet(user, id) {
    return runWithLogs(log, "adminGet", () => ({ id_user: user?.id_user, id }), async () => {
      const post = await BlogStorage.getById(pool, id);
      if (!post) return { error: "Post não encontrado", statusCode: 404 };
      return { post };
    });
  }

  static async create(user, body = {}, file = null) {
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const title = sanitize(body.title, TITLE_MAX);
      if (!title) return { error: "Título é obrigatório" };

      const body_md = sanitize(body.body_md, BODY_MAX) || "";
      const status = body.status === "published" ? "published" : "draft";

      let cover_url = sanitize(body.cover_url, 1024);
      if (file) {
        try {
          cover_url = await uploadBlogCoverToR2({ file });
        } catch (err) {
          log.error("cover.upload.fail", { message: err.message });
          return { error: "Falha ao subir a capa" };
        }
      }

      const client = await pool.connect();
      try {
        const slug = await ensureUniqueSlug(client, body.slug || title);
        const post = await BlogStorage.create(client, {
          slug,
          title,
          excerpt: sanitize(body.excerpt, EXCERPT_MAX),
          cover_url,
          cover_alt: sanitize(body.cover_alt, 200),
          body_md,
          category: sanitize(body.category, 60),
          tags: normalizeTags(body.tags),
          status,
          reading_minutes: readingMinutes(body_md),
          seo_title: sanitize(body.seo_title, SEO_TITLE_MAX),
          seo_description: sanitize(body.seo_description, SEO_DESC_MAX),
          author_name: sanitize(body.author_name, 80) || "Equipe Freelandoo",
          published_at: status === "published" ? new Date() : null,
          created_by: user.id_user,
        });
        return { post };
      } finally {
        client.release();
      }
    });
  }

  static async update(user, id, body = {}, file = null) {
    return runWithLogs(log, "update", () => ({ id_user: user?.id_user, id }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const client = await pool.connect();
      try {
        const existing = await BlogStorage.getById(client, id);
        if (!existing) return { error: "Post não encontrado", statusCode: 404 };

        const patch = {};
        if (body.title !== undefined) {
          const title = sanitize(body.title, TITLE_MAX);
          if (!title) return { error: "Título é obrigatório" };
          patch.title = title;
        }
        if (body.slug !== undefined && body.slug) {
          const desired = String(body.slug).trim();
          if (desired && desired !== existing.slug) {
            patch.slug = await ensureUniqueSlug(client, desired, id);
          }
        }
        if (body.excerpt !== undefined) patch.excerpt = sanitize(body.excerpt, EXCERPT_MAX);
        if (body.cover_alt !== undefined) patch.cover_alt = sanitize(body.cover_alt, 200);
        if (body.category !== undefined) patch.category = sanitize(body.category, 60);
        if (body.tags !== undefined) patch.tags = normalizeTags(body.tags);
        if (body.seo_title !== undefined) patch.seo_title = sanitize(body.seo_title, SEO_TITLE_MAX);
        if (body.seo_description !== undefined) patch.seo_description = sanitize(body.seo_description, SEO_DESC_MAX);
        if (body.author_name !== undefined) patch.author_name = sanitize(body.author_name, 80) || "Equipe Freelandoo";
        if (body.body_md !== undefined) {
          patch.body_md = sanitize(body.body_md, BODY_MAX) || "";
          patch.reading_minutes = readingMinutes(patch.body_md);
        }

        if (file) {
          try {
            patch.cover_url = await uploadBlogCoverToR2({ file });
          } catch (err) {
            log.error("cover.upload.fail", { message: err.message });
            return { error: "Falha ao subir a capa" };
          }
        } else if (body.cover_url !== undefined) {
          patch.cover_url = sanitize(body.cover_url, 1024);
        }

        // Transição de status (publicar / despublicar) controla published_at.
        if (body.status !== undefined) {
          const next = body.status === "published" ? "published" : "draft";
          patch.status = next;
          if (next === "published" && !existing.published_at) {
            patch.published_at = new Date();
          }
        }

        const post = await BlogStorage.update(client, id, patch, user.id_user);
        return { post };
      } finally {
        client.release();
      }
    });
  }

  static async remove(user, id) {
    return runWithLogs(log, "remove", () => ({ id_user: user?.id_user, id }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const removed = await BlogStorage.remove(pool, id);
      if (!removed) return { error: "Post não encontrado", statusCode: 404 };
      return { ok: true, id: removed.id };
    });
  }

  static async uploadCover(user, file) {
    return runWithLogs(log, "uploadCover", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!file) return { error: "Arquivo é obrigatório" };
      try {
        const url = await uploadBlogCoverToR2({ file });
        return { url };
      } catch (err) {
        log.error("cover.upload.fail", { message: err.message });
        return { error: "Falha ao subir a capa" };
      }
    });
  }
}

module.exports = BlogService;
