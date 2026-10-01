// src/services/ProductCollectionService.js
// COLEÇÕES DA LOJA (mig 271): a dona agrupa os produtos da vitrine dela
// ("New Drop", "Chrome", "Charms") e cada coleção vira uma página do site.
//
// ⚠️ O ENDEREÇO DA COLEÇÃO CONGELA DEPOIS DE CRIADO. O slug sai do nome na
// criação e não acompanha renomes: publicado, ele é o que está no Google e no
// que as pessoas colaram (mesma regra das sub-páginas do site, mig 238).
// Trocar o endereço é um gesto explícito (`slug` no PATCH).
//
// ⚠️ O ENDEREÇO DIVIDE O NAMESPACE `/pagina/<slug>` com as páginas fixas do
// site — por isso `loja`, `sobre` e `agendar` são recusados.

const pool = require("../databases");
const ProfileStorage = require("../storages/ProfileStorage");
const ProductCollectionStorage = require("../storages/ProductCollectionStorage");
const uploadProductMediaToR2 = require("../integrations/r2/uploadProductMedia");
const { processPortfolioMedia } = require("../utils/mediaJobs");
const { hasUpload } = require("../utils/mediaProcessing");
const { slugify } = require("../utils/slug");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProductCollectionService");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESERVED = new Set(["loja", "sobre", "agendar", "pagina", "carrinho", "busca"]);
const MAX_COLLECTIONS = 30;

async function assertOwner(conn, id_profile, id_user) {
  if (!id_user) return { error: "Não autenticado", statusCode: 401 };
  if (!UUID_RE.test(String(id_profile || ""))) return { error: "id_profile inválido" };
  const profile = await ProfileStorage.getProfileById(conn, id_profile);
  if (!profile) return { error: "Perfil não encontrado", statusCode: 404 };
  if (String(profile.id_user) !== String(id_user)) {
    return { error: "Sem permissão para alterar este perfil", statusCode: 403 };
  }
  if (profile.is_clan) return { error: "Clans não podem ter loja de produtos" };
  return { profile };
}

function cleanText(v, max) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function validateSlug(raw) {
  const slug = slugify(raw).slice(0, 60).replace(/-+$/, "");
  if (slug.length < 2) return { error: "Endereço da coleção muito curto." };
  if (RESERVED.has(slug)) return { error: `"${slug}" é um endereço reservado do site.` };
  return { slug };
}

async function load(conn, id_profile, id_collection) {
  const id = Number(id_collection);
  if (!Number.isInteger(id) || id <= 0) return null;
  const c = await ProductCollectionStorage.getById(conn, id);
  if (!c || String(c.id_profile) !== String(id_profile)) return null;
  return c;
}

class ProductCollectionService {
  static async list(user, params) {
    const own = await assertOwner(pool, params?.id_profile, user?.id_user);
    if (own.error) return own;
    return { collections: await ProductCollectionStorage.listByProfile(pool, params.id_profile) };
  }

  static async create(user, params, body = {}) {
    return runWithLogs(log, "create", () => ({ id_profile: params?.id_profile }), async () => {
      const own = await assertOwner(pool, params?.id_profile, user?.id_user);
      if (own.error) return own;
      const name = cleanText(body.name, 60);
      if (!name) return { error: "Dê um nome para a coleção." };

      const existing = await ProductCollectionStorage.listByProfile(pool, params.id_profile);
      if (existing.length >= MAX_COLLECTIONS) {
        return { error: `No máximo ${MAX_COLLECTIONS} coleções por loja.` };
      }

      const s = validateSlug(body.slug || name);
      if (s.error) return s;
      // Nome repetido ganha sufixo em vez de recusa: a dona pode querer duas
      // coleções "Pink"; o endereço ela troca quando quiser.
      let slug = s.slug;
      for (let n = 2; await ProductCollectionStorage.slugTaken(pool, params.id_profile, slug); n += 1) {
        slug = `${s.slug}-${n}`;
      }

      const collection = await ProductCollectionStorage.create(pool, {
        id_profile: params.id_profile,
        name,
        slug,
        kicker: cleanText(body.kicker, 40),
        description: cleanText(body.description, 600),
        sort_order: await ProductCollectionStorage.nextSortOrder(pool, params.id_profile),
      });
      return { collection: { ...collection, products_count: 0 } };
    });
  }

  static async update(user, params, body = {}) {
    return runWithLogs(log, "update", () => ({ id_collection: params?.id_collection }), async () => {
      const own = await assertOwner(pool, params?.id_profile, user?.id_user);
      if (own.error) return own;
      const current = await load(pool, params.id_profile, params.id_collection);
      if (!current) return { error: "Coleção não encontrada", statusCode: 404 };

      const fields = {};
      if (Object.prototype.hasOwnProperty.call(body, "name")) {
        const name = cleanText(body.name, 60);
        if (!name) return { error: "Dê um nome para a coleção." };
        fields.name = name;
      }
      if (Object.prototype.hasOwnProperty.call(body, "kicker")) fields.kicker = cleanText(body.kicker, 40);
      if (Object.prototype.hasOwnProperty.call(body, "description")) {
        fields.description = cleanText(body.description, 600);
      }
      if (Object.prototype.hasOwnProperty.call(body, "slug")) {
        const s = validateSlug(body.slug);
        if (s.error) return s;
        if (s.slug !== current.slug) {
          if (await ProductCollectionStorage.slugTaken(pool, params.id_profile, s.slug, current.id_collection)) {
            return { error: "Já existe uma coleção com esse endereço.", statusCode: 409 };
          }
          fields.slug = s.slug;
        }
      }
      const collection = await ProductCollectionStorage.update(pool, current.id_collection, fields);
      return { collection };
    });
  }

  static async remove(user, params) {
    const own = await assertOwner(pool, params?.id_profile, user?.id_user);
    if (own.error) return own;
    const current = await load(pool, params.id_profile, params.id_collection);
    if (!current) return { error: "Coleção não encontrada", statusCode: 404 };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await ProductCollectionStorage.softDelete(client, current.id_collection);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return { ok: true };
  }

  static async reorder(user, params, body = {}) {
    const own = await assertOwner(pool, params?.id_profile, user?.id_user);
    if (own.error) return own;
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    if (ids.length === 0) return { error: "Ordem vazia." };
    await ProductCollectionStorage.reorder(pool, params.id_profile, ids);
    return { collections: await ProductCollectionStorage.listByProfile(pool, params.id_profile) };
  }

  /** A capa da coleção: a imagem do portal no site. */
  static async uploadCover(user, params, file) {
    return runWithLogs(log, "uploadCover", () => ({ id_collection: params?.id_collection }), async () => {
      const own = await assertOwner(pool, params?.id_profile, user?.id_user);
      if (own.error) return own;
      // A permissão vem ANTES dos bytes irem ao R2 (regra do site, mig 212).
      const current = await load(pool, params.id_profile, params.id_collection);
      if (!current) return { error: "Coleção não encontrada", statusCode: 404 };
      if (!hasUpload(file)) return { error: "Arquivo não enviado" };
      if (!String(file.mimetype || "").toLowerCase().startsWith("image/")) {
        return { error: "A capa precisa ser uma imagem." };
      }
      const processed = await processPortfolioMedia(file, "image");
      const up = await uploadProductMediaToR2({
        id_profile: params.id_profile,
        id_profile_product: `collection-${current.id_collection}`,
        file: processed,
      });
      const collection = await ProductCollectionStorage.update(pool, current.id_collection, {
        cover_url: up.url,
        cover_key: up.key,
      });
      return { collection };
    });
  }

  static async removeCover(user, params) {
    const own = await assertOwner(pool, params?.id_profile, user?.id_user);
    if (own.error) return own;
    const current = await load(pool, params.id_profile, params.id_collection);
    if (!current) return { error: "Coleção não encontrada", statusCode: 404 };
    const collection = await ProductCollectionStorage.update(pool, current.id_collection, {
      cover_url: null,
      cover_key: null,
    });
    return { collection };
  }

  /** O produto pode apontar para esta coleção? (mesmo perfil, viva). */
  static async belongsTo(conn, id_profile, id_collection) {
    return !!(await load(conn, id_profile, id_collection));
  }
}

module.exports = ProductCollectionService;
