const pool = require("../databases");
const ProfileStorage = require("../storages/ProfileStorage");
const PortfolioStorage = require("../storages/PortfolioStorage");
const ClanStorage = require("../storages/ClanStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("PortfolioService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj || {}, k);

/**
 * Verifica permissão de edição de portfólio considerando clans.
 * - Perfil normal: só dono (id_user)
 * - Clan + mode='add': qualquer membro
 * - Clan + mode='modify': só owner do clan
 * Retorna { error } se bloqueado, ou null se ok.
 */
async function checkPortfolioAccess(conn, profile, user, mode) {
  if (!profile.is_clan) {
    if (String(profile.id_user) !== String(user.id_user)) {
      return { error: "Você não tem permissão para alterar este perfil" };
    }
    return null;
  }
  const membership = await ClanStorage.getUserMembership(
    conn,
    profile.id_profile,
    user.id_user
  );
  if (!membership) {
    return { error: "Apenas membros do clan podem editar o portfólio" };
  }
  if (mode === "modify" && membership.role !== "owner") {
    return {
      error: "Apenas o dono do clan pode editar ou remover itens do portfólio",
    };
  }
  return null;
}

function normalizeNonEmptyString(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null) return null; // permitir limpar com null (em PATCH)
  if (typeof value !== "string") return { error: `${fieldName} inválido` };

  const trimmed = value.trim();
  if (trimmed.length === 0) return { error: `${fieldName} não pode ser vazio` };
  return trimmed;
}

function normalizeOptionalUrl(value, fieldName) {
  // aceita undefined (não mexe), null (limpa no PATCH), string não vazia
  const norm = normalizeNonEmptyString(value, fieldName);
  return norm;
}

function normalizeBoolean(value, fieldName) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") return { error: `${fieldName} inválido` };
  return value;
}

function normalizeInt(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null) return null; // pode limpar em PATCH se quiser
  const n = Number(value);
  if (!Number.isInteger(n)) return { error: `${fieldName} inválido` };
  return n;
}

function normalizeMediaType(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return { error: "media_type inválido" };
  const t = value.trim().toLowerCase();
  if (!["image", "video", "file"].includes(t))
    return { error: "media_type inválido" };
  return t;
}

class PortfolioService {
  static async listPublic(params) {
    return runWithLogs(
      log,
      "listPublic",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const { id_profile } = params;
        if (!id_profile || !UUID_RE.test(id_profile))
          return { error: "id_profile inválido" };

        const profile = await ProfileStorage.getProfileById(pool, id_profile);
        if (profile?.is_clan) {
          const members = await ClanStorage.listMembers(pool, id_profile);
          const memberIds = members.map((m) => m.id_member_profile);
          const items = await PortfolioStorage.listAggregatedItemsForClanPublic(
            pool,
            id_profile,
            memberIds,
            params?.id_user_viewer ?? null
          );
          return { items };
        }

        const items = await PortfolioStorage.listItemsWithMediaPublic(
          pool,
          id_profile,
          params?.id_user_viewer ?? null
        );
        return { items };
      }
    );
  }

  static async createItem(user, params, payload) {
    return runWithLogs(
      log,
      "createItem",
      () => ({
        id_user: user?.id_user,
        id_profile: params?.id_profile,
      }),
      async () => {
        const { id_profile } = params;
        if (!user?.id_user) return { error: "Não autenticado" };
    if (!id_profile || !UUID_RE.test(id_profile))
      return { error: "id_profile inválido" };

    // valida campos
    const title = normalizeNonEmptyString(payload?.title, "title");
    if (title?.error) return title;

    const description = normalizeOptionalUrl(
      payload?.description,
      "description"
    );
    if (description?.error) return description;

    const project_url = normalizeOptionalUrl(
      payload?.project_url,
      "project_url"
    );
    if (project_url?.error) return project_url;

    const is_featured = normalizeBoolean(payload?.is_featured, "is_featured");
    if (is_featured?.error) return is_featured;

    const sort_order = normalizeInt(payload?.sort_order, "sort_order");
    if (sort_order?.error) return sort_order;

    // mídias opcionais
    const media = payload?.media;
    if (media !== undefined && !Array.isArray(media)) {
      return { error: "media deve ser um array" };
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const profile = await ProfileStorage.getProfileById(client, id_profile);
      if (!profile) {
        await client.query("ROLLBACK");
        return { error: "Perfil não encontrado" };
      }
      const accessErr = await checkPortfolioAccess(client, profile, user, "add");
      if (accessErr) {
        await client.query("ROLLBACK");
        return accessErr;
      }

      const item = await PortfolioStorage.createItem(client, {
        id_profile,
        title,
        description: description === undefined ? null : description,
        project_url: project_url === undefined ? null : project_url,
        is_featured: is_featured === undefined ? false : is_featured,
        sort_order:
          sort_order === undefined || sort_order === null ? 0 : sort_order,
        created_by: user.id_user,
      });

      // inserir mídias
      if (Array.isArray(media) && media.length > 0) {
        for (const m of media) {
          const media_url = normalizeNonEmptyString(m?.media_url, "media_url");
          if (media_url?.error) {
            await client.query("ROLLBACK");
            return media_url;
          }

          const media_type = normalizeMediaType(m?.media_type);
          if (media_type?.error) {
            await client.query("ROLLBACK");
            return media_type;
          }

          const thumbnail_url = normalizeOptionalUrl(
            m?.thumbnail_url,
            "thumbnail_url"
          );
          if (thumbnail_url?.error) {
            await client.query("ROLLBACK");
            return thumbnail_url;
          }

          const mSort = normalizeInt(m?.sort_order, "sort_order");
          if (mSort?.error) {
            await client.query("ROLLBACK");
            return mSort;
          }

          await PortfolioStorage.addMedia(client, {
            id_portfolio_item: item.id_portfolio_item,
            media_url,
            media_type,
            thumbnail_url: thumbnail_url === undefined ? null : thumbnail_url,
            sort_order: mSort === undefined || mSort === null ? 0 : mSort,
            created_by: user.id_user,
          });
        }
      }

      await client.query("COMMIT");

      // retorna item completo com media[]
      const full = await PortfolioStorage.getItemWithMedia(
        pool,
        item.id_portfolio_item
      );
      return { message: "Item de portfólio criado com sucesso", item: full };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
      }
    );
  }

  static async updateItem(user, params, payload) {
    return runWithLogs(
      log,
      "updateItem",
      () => ({
        id_user: user?.id_user,
        id_profile: params?.id_profile,
        id_portfolio_item: params?.id_portfolio_item,
      }),
      async () => {
    const { id_profile, id_portfolio_item } = params;
    if (!user?.id_user) return { error: "Não autenticado" };
    if (!id_profile || !UUID_RE.test(id_profile))
      return { error: "id_profile inválido" };
    if (!id_portfolio_item || !UUID_RE.test(id_portfolio_item))
      return { error: "id_portfolio_item inválido" };

    const hasAny = [
      "title",
      "description",
      "project_url",
      "is_featured",
      "sort_order",
      "is_active",
    ].some((k) => has(payload, k));
    if (!hasAny) return { error: "Nenhum campo para atualizar" };

    // valida campos se vierem
    let title;
    if (has(payload, "title")) {
      title = normalizeNonEmptyString(payload.title, "title");
      if (title?.error) return title;
    }

    let description;
    if (has(payload, "description")) {
      description = normalizeOptionalUrl(payload.description, "description");
      if (description?.error) return description;
    }

    let project_url;
    if (has(payload, "project_url")) {
      project_url = normalizeOptionalUrl(payload.project_url, "project_url");
      if (project_url?.error) return project_url;
    }

    let is_featured;
    if (has(payload, "is_featured")) {
      is_featured = normalizeBoolean(payload.is_featured, "is_featured");
      if (is_featured?.error) return is_featured;
    }

    let sort_order;
    if (has(payload, "sort_order")) {
      sort_order = normalizeInt(payload.sort_order, "sort_order");
      if (sort_order?.error) return sort_order;
      if (sort_order === null) return { error: "sort_order não pode ser null" };
    }

    let is_active;
    if (has(payload, "is_active")) {
      is_active = normalizeBoolean(payload.is_active, "is_active");
      if (is_active?.error) return is_active;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const profile = await ProfileStorage.getProfileById(client, id_profile);
      if (!profile) {
        await client.query("ROLLBACK");
        return { error: "Perfil não encontrado" };
      }
      const accessErr = await checkPortfolioAccess(client, profile, user, "modify");
      if (accessErr) {
        await client.query("ROLLBACK");
        return accessErr;
      }

      // garante que o item pertence ao perfil
      const belongs = await PortfolioStorage.itemBelongsToProfile(
        client,
        id_portfolio_item,
        id_profile
      );
      if (!belongs) {
        await client.query("ROLLBACK");
        return { error: "Item não encontrado para este perfil" };
      }

      const updated = await PortfolioStorage.updateItem(
        client,
        id_portfolio_item,
        {
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(project_url !== undefined ? { project_url } : {}),
          ...(is_featured !== undefined ? { is_featured } : {}),
          ...(sort_order !== undefined ? { sort_order } : {}),
          ...(is_active !== undefined ? { is_active } : {}),
          updated_by: user.id_user,
        }
      );

      if (!updated) {
        await client.query("ROLLBACK");
        return { error: "Item não encontrado" };
      }

      await client.query("COMMIT");

      const full = await PortfolioStorage.getItemWithMedia(
        pool,
        id_portfolio_item
      );
      return {
        message: "Item de portfólio atualizado com sucesso",
        item: full,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
      }
    );
  }

  static async disableItem(user, params) {
    return runWithLogs(
      log,
      "disableItem",
      () => ({
        id_user: user?.id_user,
        id_profile: params?.id_profile,
        id_portfolio_item: params?.id_portfolio_item,
      }),
      async () => {
    const { id_profile, id_portfolio_item } = params;
    if (!user?.id_user) return { error: "Não autenticado" };
    if (!id_profile || !UUID_RE.test(id_profile))
      return { error: "id_profile inválido" };
    if (!id_portfolio_item || !UUID_RE.test(id_portfolio_item))
      return { error: "id_portfolio_item inválido" };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const profile = await ProfileStorage.getProfileById(client, id_profile);
      if (!profile) {
        await client.query("ROLLBACK");
        return { error: "Perfil não encontrado" };
      }
      const accessErr = await checkPortfolioAccess(client, profile, user, "modify");
      if (accessErr) {
        await client.query("ROLLBACK");
        return accessErr;
      }

      const belongs = await PortfolioStorage.itemBelongsToProfile(
        client,
        id_portfolio_item,
        id_profile
      );
      if (!belongs) {
        await client.query("ROLLBACK");
        return { error: "Item não encontrado para este perfil" };
      }

      const ok = await PortfolioStorage.disableItem(
        client,
        id_portfolio_item,
        user.id_user
      );
      if (!ok) {
        await client.query("ROLLBACK");
        return { error: "Item não encontrado" };
      }

      await client.query("COMMIT");
      return { message: "Item removido com sucesso" };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
      }
    );
  }

  static async addMedia(user, params, payload) {
    return runWithLogs(
      log,
      "addMedia",
      () => ({
        id_user: user?.id_user,
        id_profile: params?.id_profile,
        id_portfolio_item: params?.id_portfolio_item,
      }),
      async () => {
    const { id_profile, id_portfolio_item } = params;
    if (!user?.id_user) return { error: "Não autenticado" };
    if (!id_profile || !UUID_RE.test(id_profile))
      return { error: "id_profile inválido" };
    if (!id_portfolio_item || !UUID_RE.test(id_portfolio_item))
      return { error: "id_portfolio_item inválido" };

    const media_url = normalizeNonEmptyString(payload?.media_url, "media_url");
    if (media_url?.error) return media_url;

    const media_type = normalizeMediaType(payload?.media_type);
    if (media_type?.error) return media_type;

    const thumbnail_url = normalizeOptionalUrl(
      payload?.thumbnail_url,
      "thumbnail_url"
    );
    if (thumbnail_url?.error) return thumbnail_url;

    const sort_order = normalizeInt(payload?.sort_order, "sort_order");
    if (sort_order?.error) return sort_order;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const profile = await ProfileStorage.getProfileById(client, id_profile);
      if (!profile) {
        await client.query("ROLLBACK");
        return { error: "Perfil não encontrado" };
      }
      const accessErr = await checkPortfolioAccess(client, profile, user, "add");
      if (accessErr) {
        await client.query("ROLLBACK");
        return accessErr;
      }

      const belongs = await PortfolioStorage.itemBelongsToProfile(
        client,
        id_portfolio_item,
        id_profile
      );
      if (!belongs) {
        await client.query("ROLLBACK");
        return { error: "Item não encontrado para este perfil" };
      }

      const m = await PortfolioStorage.addMedia(client, {
        id_portfolio_item,
        media_url,
        media_type,
        thumbnail_url: thumbnail_url === undefined ? null : thumbnail_url,
        sort_order:
          sort_order === undefined || sort_order === null ? 0 : sort_order,
        created_by: user.id_user,
      });

      await client.query("COMMIT");
      return { message: "Mídia adicionada com sucesso", media: m };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
      }
    );
  }

  static async disableMedia(user, params) {
    return runWithLogs(
      log,
      "disableMedia",
      () => ({
        id_user: user?.id_user,
        id_profile: params?.id_profile,
        id_portfolio_item: params?.id_portfolio_item,
        id_portfolio_media: params?.id_portfolio_media,
      }),
      async () => {
    const { id_profile, id_portfolio_item, id_portfolio_media } = params;

    if (!user?.id_user) return { error: "Não autenticado" };
    if (!id_profile || !UUID_RE.test(id_profile))
      return { error: "id_profile inválido" };
    if (!id_portfolio_item || !UUID_RE.test(id_portfolio_item))
      return { error: "id_portfolio_item inválido" };
    if (!id_portfolio_media || !UUID_RE.test(id_portfolio_media))
      return { error: "id_portfolio_media inválido" };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const profile = await ProfileStorage.getProfileById(client, id_profile);
      if (!profile) {
        await client.query("ROLLBACK");
        return { error: "Perfil não encontrado" };
      }
      const accessErr = await checkPortfolioAccess(client, profile, user, "modify");
      if (accessErr) {
        await client.query("ROLLBACK");
        return accessErr;
      }

      const belongs = await PortfolioStorage.itemBelongsToProfile(
        client,
        id_portfolio_item,
        id_profile
      );
      if (!belongs) {
        await client.query("ROLLBACK");
        return { error: "Item não encontrado para este perfil" };
      }

      const mediaBelongs = await PortfolioStorage.mediaBelongsToItem(
        client,
        id_portfolio_media,
        id_portfolio_item
      );
      if (!mediaBelongs) {
        await client.query("ROLLBACK");
        return { error: "Mídia não encontrada para este item" };
      }

      const ok = await PortfolioStorage.disableMedia(
        client,
        id_portfolio_media
      );
      if (!ok) {
        await client.query("ROLLBACK");
        return { error: "Mídia não encontrada" };
      }

      await client.query("COMMIT");
      return { message: "Mídia removida com sucesso" };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
      }
    );
  }
}

module.exports = PortfolioService;
