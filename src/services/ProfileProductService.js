const pool = require("../databases");
const ProfileProductStorage = require("../storages/ProfileProductStorage");
const ProfileProductMediaStorage = require("../storages/ProfileProductMediaStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
const r2 = require("./r2Client");
const uploadProductMediaToR2 = require("../integrations/r2/uploadProductMedia");
const { processPortfolioMedia } = require("../utils/mediaProcessing");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProfileProductService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeZipcode(z) {
  if (z === null || z === undefined) return null;
  const digits = String(z).replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

async function assertOwnerWithProfile(conn, id_profile, id_user) {
  const profile = await ProfileStorage.getProfileById(conn, id_profile);
  if (!profile) return { error: "Perfil não encontrado" };
  if (String(profile.id_user) !== String(id_user)) {
    return { error: "Sem permissão para alterar este perfil" };
  }
  if (profile.is_clan) {
    return { error: "Clans não podem ter loja de produtos" };
  }
  return { profile };
}

async function isProfilePaid(conn, id_profile) {
  const r = await conn.query(
    `SELECT 1 FROM public.tb_profile_subscription
      WHERE id_profile = $1 AND status = 'active'
      LIMIT 1`,
    [id_profile]
  );
  return r.rowCount > 0;
}

function validateInput(payload, { partial = false } = {}) {
  const out = {};

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "name")) {
    if (typeof payload.name !== "string" || payload.name.trim().length === 0) {
      return { error: "Nome do produto é obrigatório" };
    }
    out.name = payload.name.trim().slice(0, 160);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "description")) {
    if (payload.description !== null && typeof payload.description !== "string") {
      return { error: "Descrição inválida" };
    }
    out.description = payload.description ? payload.description.trim() : null;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "price_amount")) {
    const p = Number(payload.price_amount);
    if (!Number.isInteger(p) || p < 0) {
      return { error: "Preço inválido (em centavos, >= 0)" };
    }
    out.price_amount = p;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "stock_quantity")) {
    const s = Number(payload.stock_quantity);
    if (!Number.isInteger(s) || s < 0) {
      return { error: "Estoque inválido (>= 0)" };
    }
    out.stock_quantity = s;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "weight_grams")) {
    const w = Number(payload.weight_grams);
    if (!Number.isInteger(w) || w < 0) {
      return { error: "Peso inválido (em gramas, >= 0)" };
    }
    out.weight_grams = w;
  }

  for (const dim of ["height_cm", "width_cm", "length_cm"]) {
    if (!partial || Object.prototype.hasOwnProperty.call(payload, dim)) {
      const v = Number(payload[dim]);
      if (!Number.isFinite(v) || v < 0) {
        return { error: `Dimensão inválida (${dim})` };
      }
      out[dim] = v;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "origin_zipcode_override")) {
    if (payload.origin_zipcode_override === null || payload.origin_zipcode_override === "") {
      out.origin_zipcode_override = null;
    } else {
      const z = normalizeZipcode(payload.origin_zipcode_override);
      if (!z) return { error: "CEP de origem do produto inválido (8 dígitos)" };
      out.origin_zipcode_override = z;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "is_active")) {
    if (typeof payload.is_active !== "boolean") return { error: "is_active inválido" };
    out.is_active = payload.is_active;
  }

  return { data: out };
}

class ProfileProductService {
  // ─── CRUD dono ─────────────────────────────────────────────────────────────
  static async list(user, params) {
    return runWithLogs(log, "list", () => ({ id_user: user?.id_user, id_profile: params?.id_profile }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { id_profile } = params;
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      const own = await assertOwnerWithProfile(pool, id_profile, user.id_user);
      if (own.error) return { error: own.error };

      const products = await ProfileProductStorage.list(pool, id_profile);
      const ids = products.map((p) => Number(p.id_profile_product));
      const mediaMap = await ProfileProductMediaStorage.listByProducts(pool, ids);
      const isPaid = await isProfilePaid(pool, id_profile);

      return {
        profile_is_paid: isPaid,
        products: products.map((p) => ({
          ...p,
          media: mediaMap.get(String(p.id_profile_product)) || [],
        })),
      };
    });
  }

  static async create(user, params, body) {
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user, id_profile: params?.id_profile }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { id_profile } = params;
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };

      const v = validateInput(body || {});
      if (v.error) return { error: v.error };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const own = await assertOwnerWithProfile(client, id_profile, user.id_user);
        if (own.error) { await client.query("ROLLBACK"); return { error: own.error }; }

        const wantsActive = v.data.is_active !== false; // default TRUE
        if (wantsActive) {
          const paid = await isProfilePaid(client, id_profile);
          if (!paid) {
            await client.query("ROLLBACK");
            return { error: "Apenas subperfis pagos podem publicar produtos. Ative a assinatura para vender." };
          }
        }

        const product = await ProfileProductStorage.create(client, {
          id_profile,
          ...v.data,
        });
        await client.query("COMMIT");
        return { product: { ...product, media: [] } };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally { client.release(); }
    });
  }

  static async update(user, params, body) {
    return runWithLogs(log, "update", () => ({ id_user: user?.id_user, id_profile: params?.id_profile, id_profile_product: params?.id_profile_product }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { id_profile, id_profile_product } = params;
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      if (!id_profile_product || isNaN(Number(id_profile_product))) return { error: "id_profile_product inválido" };

      const v = validateInput(body || {}, { partial: true });
      if (v.error) return { error: v.error };
      if (Object.keys(v.data).length === 0) return { error: "Nenhum campo para atualizar" };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const own = await assertOwnerWithProfile(client, id_profile, user.id_user);
        if (own.error) { await client.query("ROLLBACK"); return { error: own.error }; }

        const existing = await ProfileProductStorage.getById(client, Number(id_profile_product));
        if (!existing || String(existing.id_profile) !== String(id_profile)) {
          await client.query("ROLLBACK");
          return { error: "Produto não encontrado" };
        }

        // Se está reativando (ou criando ativo) e o sub não é mais pago, bloqueia.
        const willBeActive =
          Object.prototype.hasOwnProperty.call(v.data, "is_active")
            ? v.data.is_active
            : existing.is_active;
        if (willBeActive) {
          const paid = await isProfilePaid(client, id_profile);
          if (!paid) {
            await client.query("ROLLBACK");
            return { error: "Subperfil sem assinatura ativa. Reative a assinatura ou marque o produto como inativo." };
          }
        }

        const product = await ProfileProductStorage.update(client, Number(id_profile_product), v.data);
        await client.query("COMMIT");
        const media = await ProfileProductMediaStorage.listByProduct(pool, Number(id_profile_product));
        return { product: { ...product, media } };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally { client.release(); }
    });
  }

  static async remove(user, params) {
    return runWithLogs(log, "remove", () => ({ id_user: user?.id_user, id_profile: params?.id_profile, id_profile_product: params?.id_profile_product }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { id_profile, id_profile_product } = params;
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      if (!id_profile_product || isNaN(Number(id_profile_product))) return { error: "id_profile_product inválido" };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const own = await assertOwnerWithProfile(client, id_profile, user.id_user);
        if (own.error) { await client.query("ROLLBACK"); return { error: own.error }; }

        const existing = await ProfileProductStorage.getById(client, Number(id_profile_product));
        if (!existing || String(existing.id_profile) !== String(id_profile)) {
          await client.query("ROLLBACK");
          return { error: "Produto não encontrado" };
        }
        await ProfileProductStorage.softDelete(client, Number(id_profile_product));
        await client.query("COMMIT");
        return { message: "Produto removido" };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally { client.release(); }
    });
  }

  // ─── Listagem pública ──────────────────────────────────────────────────────
  static async listPublic(id_profile) {
    return runWithLogs(log, "listPublic", () => ({ id_profile }), async () => {
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      const profile = await ProfileStorage.getProfileById(pool, id_profile);
      if (!profile) return { error: "Perfil não encontrado" };
      if (profile.is_clan) return { products: [] }; // clans não vendem produto

      const paid = await isProfilePaid(pool, id_profile);
      if (!paid) return { products: [] }; // loja pausada quando assinatura não-ativa

      const products = await ProfileProductStorage.list(pool, id_profile, { only_active: true });
      const ids = products.map((p) => Number(p.id_profile_product));
      const mediaMap = await ProfileProductMediaStorage.listByProducts(pool, ids);
      return {
        products: products.map((p) => ({
          ...p,
          media: mediaMap.get(String(p.id_profile_product)) || [],
        })),
      };
    });
  }

  static async getPublicById(id_profile, id_profile_product) {
    return runWithLogs(log, "getPublicById", () => ({ id_profile, id_profile_product }), async () => {
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      if (!id_profile_product || isNaN(Number(id_profile_product))) return { error: "id_profile_product inválido" };

      const profile = await ProfileStorage.getProfileById(pool, id_profile);
      if (!profile) return { error: "Perfil não encontrado" };
      if (profile.is_clan) return { error: "Produto não encontrado" };

      const paid = await isProfilePaid(pool, id_profile);
      if (!paid) return { error: "Loja indisponível" };

      const product = await ProfileProductStorage.getById(pool, Number(id_profile_product));
      if (!product || String(product.id_profile) !== String(id_profile) || !product.is_active) {
        return { error: "Produto não encontrado" };
      }
      const media = await ProfileProductMediaStorage.listByProduct(pool, Number(id_profile_product));
      return { product: { ...product, media } };
    });
  }

  // ─── Mídias ────────────────────────────────────────────────────────────────
  static async uploadMedia(user, params, file) {
    return runWithLogs(log, "uploadMedia", () => ({ id_user: user?.id_user, ...params }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { id_profile, id_profile_product } = params;
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      if (!id_profile_product || isNaN(Number(id_profile_product))) return { error: "id_profile_product inválido" };

      const own = await assertOwnerWithProfile(pool, id_profile, user.id_user);
      if (own.error) return { error: own.error };

      const product = await ProfileProductStorage.getById(pool, Number(id_profile_product));
      if (!product || String(product.id_profile) !== String(id_profile)) {
        return { error: "Produto não encontrado" };
      }

      if (!file || !file.buffer) return { error: "Arquivo não enviado" };

      const mimetype = String(file.mimetype || "").toLowerCase();
      const mediaType = mimetype.startsWith("image/")
        ? "image"
        : mimetype.startsWith("video/")
          ? "video"
          : null;
      if (!mediaType) return { error: "Tipo de arquivo não permitido" };

      const processedFile = await processPortfolioMedia(file, mediaType);

      const r2Result = await uploadProductMediaToR2({
        id_profile,
        id_profile_product: String(id_profile_product),
        file: processedFile,
      });

      const meta = processedFile.mediaMetadata || {};
      const media = await ProfileProductMediaStorage.create(pool, {
        id_profile_product: Number(id_profile_product),
        id_profile,
        media_url: r2Result.url,
        media_type: mediaType,
        thumbnail_url: r2Result.thumbnail_url,
        storage_key: r2Result.key,
        thumbnail_key: r2Result.thumbnail_key,
        original_filename: meta.original_filename || file.originalname,
        mime_type: meta.mime_type || processedFile.mimetype,
        width: meta.width || null,
        height: meta.height || null,
        size_bytes: meta.size_bytes || processedFile.size || null,
        duration_seconds: meta.duration_seconds || null,
        sort_order: 0,
      });

      return { media };
    });
  }

  static async deleteMedia(user, params) {
    return runWithLogs(log, "deleteMedia", () => ({ id_user: user?.id_user, ...params }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { id_profile, id_profile_product, id_product_media } = params;
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      if (!id_profile_product || isNaN(Number(id_profile_product))) return { error: "id_profile_product inválido" };
      if (!id_product_media || isNaN(Number(id_product_media))) return { error: "id_product_media inválido" };

      const own = await assertOwnerWithProfile(pool, id_profile, user.id_user);
      if (own.error) return { error: own.error };

      const media = await ProfileProductMediaStorage.findById(pool, Number(id_product_media));
      if (!media || String(media.id_profile_product) !== String(id_profile_product)) {
        return { error: "Mídia não encontrada" };
      }

      const keysToDelete = [media.storage_key, media.thumbnail_key].filter(Boolean);
      for (const key of keysToDelete) {
        try {
          await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
        } catch (err) {
          log.warn("deleteMedia.r2_fail", { key, err: err?.message });
        }
      }

      await ProfileProductMediaStorage.remove(pool, Number(id_product_media));
      return { deleted: true };
    });
  }

  static async listMedia(user, params) {
    return runWithLogs(log, "listMedia", () => ({ id_user: user?.id_user, ...params }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { id_profile, id_profile_product } = params;
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      if (!id_profile_product || isNaN(Number(id_profile_product))) return { error: "id_profile_product inválido" };

      const own = await assertOwnerWithProfile(pool, id_profile, user.id_user);
      if (own.error) return { error: own.error };

      const media = await ProfileProductMediaStorage.listByProduct(pool, Number(id_profile_product));
      return { media };
    });
  }

  static async reorderMedia(user, params, body) {
    return runWithLogs(log, "reorderMedia", () => ({ id_user: user?.id_user, ...params }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { id_profile, id_profile_product } = params;
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      if (!id_profile_product || isNaN(Number(id_profile_product))) return { error: "id_profile_product inválido" };

      const { ordered_ids } = body || {};
      if (!Array.isArray(ordered_ids) || ordered_ids.length === 0) {
        return { error: "ordered_ids é obrigatório (array de ids)" };
      }

      const own = await assertOwnerWithProfile(pool, id_profile, user.id_user);
      if (own.error) return { error: own.error };

      await ProfileProductMediaStorage.reorder(pool, Number(id_profile_product), ordered_ids);
      const media = await ProfileProductMediaStorage.listByProduct(pool, Number(id_profile_product));
      return { media };
    });
  }
}

module.exports = ProfileProductService;
module.exports.isProfilePaid = isProfilePaid;
module.exports.normalizeZipcode = normalizeZipcode;
