// src/services/portfolio/UploadPortfolioMediaService.js
const pool = require("../../databases");
const ProfileStorage = require("../../storages/ProfileStorage");
const PortfolioStorage = require("../../storages/PortfolioStorage");
const uploadPortfolioMediaToR2 = require("../../integrations/r2/uploadPortfolioMedia");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("UploadPortfolioMediaService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj || {}, k);

function inferMediaType(file) {
  const mt = (file?.mimetype || "").toLowerCase();
  if (mt.startsWith("image/")) return "image";
  if (mt.startsWith("video/")) return "video";
  return "file";
}

function normalizeMediaType(value, file) {
  if (value === undefined || value === null) return inferMediaType(file);
  if (typeof value !== "string") return { error: "media_type inválido" };

  const t = value.trim().toLowerCase();
  if (!["image", "video", "file"].includes(t))
    return { error: "media_type inválido" };
  return t;
}

function normalizeNonEmptyString(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return { error: `${fieldName} inválido` };

  const trimmed = value.trim();
  if (trimmed.length === 0) return { error: `${fieldName} não pode ser vazio` };
  return trimmed;
}

function normalizeInt(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return { error: `${fieldName} inválido` };
  return n;
}

module.exports = class UploadPortfolioMediaService {
  static async execute({ id_user, params, body, file }) {
    return runWithLogs(
      log,
      "execute",
      () => ({
        id_user,
        id_profile: params?.id_profile,
        id_portfolio_item: params?.id_portfolio_item,
        hasFile: !!file,
      }),
      async () => {
    const { id_profile, id_portfolio_item } = params;

    if (!id_user) {
      const err = new Error("Não autenticado");
      err.statusCode = 401;
      throw err;
    }

    if (!id_profile || !UUID_RE.test(id_profile)) {
      const err = new Error("id_profile inválido");
      err.statusCode = 400;
      throw err;
    }

    if (!id_portfolio_item || !UUID_RE.test(id_portfolio_item)) {
      const err = new Error("id_portfolio_item inválido");
      err.statusCode = 400;
      throw err;
    }

    if (!file) {
      const err = new Error("Arquivo não enviado");
      err.statusCode = 400;
      throw err;
    }

    // media_type opcional (se não vier, inferimos)
    const media_type = normalizeMediaType(body?.media_type, file);
    if (media_type?.error) {
      const err = new Error(media_type.error);
      err.statusCode = 400;
      throw err;
    }

    // thumbnail_url opcional (não aceita string vazia)
    let thumbnail_url = null;
    if (has(body, "thumbnail_url")) {
      const t = normalizeNonEmptyString(body.thumbnail_url, "thumbnail_url");
      if (t?.error) {
        const err = new Error(t.error);
        err.statusCode = 400;
        throw err;
      }
      thumbnail_url = t; // string ou null
    }

    // sort_order opcional
    let sort_order = 0;
    if (has(body, "sort_order")) {
      const s = normalizeInt(body.sort_order, "sort_order");
      if (s?.error) {
        const err = new Error(s.error);
        err.statusCode = 400;
        throw err;
      }
      if (s === null) {
        const err = new Error("sort_order não pode ser null");
        err.statusCode = 400;
        throw err;
      }
      sort_order = s ?? 0;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // ownership do perfil
      const profile = await ProfileStorage.getProfileById(client, id_profile);
      if (!profile) {
        const err = new Error("Perfil não encontrado");
        err.statusCode = 404;
        throw err;
      }
      if (String(profile.id_user) !== String(id_user)) {
        const err = new Error(
          "Você não tem permissão para alterar este perfil"
        );
        err.statusCode = 403;
        throw err;
      }

      // item pertence ao profile
      const belongs = await PortfolioStorage.itemBelongsToProfile(
        client,
        id_portfolio_item,
        id_profile
      );
      if (!belongs) {
        const err = new Error("Item não encontrado para este perfil");
        err.statusCode = 404;
        throw err;
      }

      // upload no R2
      const media_url = await uploadPortfolioMediaToR2({
        id_profile,
        id_portfolio_item,
        file,
      });

      // salva no banco
      const media = await PortfolioStorage.addMedia(client, {
        id_portfolio_item,
        media_url,
        media_type,
        thumbnail_url,
        sort_order,
        created_by: id_user,
      });

      await client.query("COMMIT");
      return { message: "Upload realizado com sucesso", media };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
      }
    );
  }
};
