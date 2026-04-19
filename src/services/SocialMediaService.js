const pool = require("../databases");
const SocialMediaStorage = require("../storages/SocialMediaStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("SocialMediaService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj || {}, k);

class SocialMediaService {
  static async upsert(user, params, payload) {
    return runWithLogs(
      log,
      "upsert",
      () => ({
        id_user: user?.id_user,
        id_profile: params?.id_profile,
      }),
      async () => {
    const { id_profile } = params;
    const { id_social_media_type, url, id_follower_range } = payload;

    if (!user?.id_user) return { error: "Não autenticado" };
    if (!id_profile || !UUID_RE.test(id_profile))
      return { error: "id_profile inválido" };
    if (!Number.isInteger(Number(id_social_media_type)))
      return { error: "id_social_media_type inválido" };

    // ✅ url: se vier, precisa ser string não vazia
    let cleanUrl = url;
    if (cleanUrl !== undefined && cleanUrl !== null) {
      if (typeof cleanUrl !== "string") return { error: "url inválida" };
      cleanUrl = cleanUrl.trim();
      if (cleanUrl.length === 0) return { error: "url não pode ser vazia" };
    }

    // follower range: se vier, precisa ser int
    if (id_follower_range !== undefined && id_follower_range !== null) {
      if (!Number.isInteger(Number(id_follower_range)))
        return { error: "id_follower_range inválido" };
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // ownership: perfil é do usuário?
      const profile = await ProfileStorage.getProfileById(client, id_profile);
      if (!profile) {
        await client.query("ROLLBACK");
        return { error: "Perfil não encontrado" };
      }
      if (String(profile.id_user) !== String(user.id_user)) {
        await client.query("ROLLBACK");
        return { error: "Você não tem permissão para alterar este perfil" };
      }

      // valida tipo ativo
      const okType = await SocialMediaStorage.socialMediaTypeExistsActive(
        client,
        Number(id_social_media_type)
      );
      if (!okType) {
        await client.query("ROLLBACK");
        return { error: "Tipo de rede social não encontrado ou inativo" };
      }

      // valida follower range se veio
      let cleanFollowerRange = undefined;
      if (id_follower_range !== undefined) {
        if (id_follower_range === null) {
          cleanFollowerRange = null; // permite limpar explicitamente
        } else {
          const okRange = await SocialMediaStorage.followerRangeExistsActive(
            client,
            Number(id_follower_range)
          );
          if (!okRange) {
            await client.query("ROLLBACK");
            return { error: "Faixa de seguidores não encontrada ou inativa" };
          }
          cleanFollowerRange = Number(id_follower_range);
        }
      }

      // ✅ upsert:
      // - se url não veio -> não altera
      // - se follower_range não veio -> não altera
      const row = await SocialMediaStorage.upsertProfileSocialMedia(client, {
        id_profile,
        id_social_media_type: Number(id_social_media_type),
        url: cleanUrl, // undefined = não altera
        id_follower_range: cleanFollowerRange, // undefined = não altera, null = limpa, number = seta
      });

      await client.query("COMMIT");
      return { message: "Rede social salva com sucesso", social_media: row };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
      }
    );
  }

  static async updateByType(user, params, payload) {
    return runWithLogs(
      log,
      "updateByType",
      () => ({
        id_user: user?.id_user,
        id_profile: params?.id_profile,
        id_social_media_type: params?.id_social_media_type,
      }),
      async () => {
    const { id_profile, id_social_media_type } = params;
    const { url, id_follower_range, is_active } = payload;

    if (!user?.id_user) return { error: "Não autenticado" };
    if (!id_profile || !UUID_RE.test(id_profile))
      return { error: "id_profile inválido" };
    if (!Number.isInteger(Number(id_social_media_type)))
      return { error: "id_social_media_type inválido" };

    const hasAny = ["url", "id_follower_range", "is_active"].some((k) =>
      has(payload, k)
    );
    if (!hasAny) return { error: "Nenhum campo para atualizar" };

    // ✅ url: se veio, precisa ser string não vazia
    let cleanUrl = undefined;
    if (has(payload, "url")) {
      if (url === null) {
        // se você quiser permitir limpar url, deixa assim; se não quiser, transforme em erro
        return { error: "url não pode ser null" };
      }
      if (typeof url !== "string") return { error: "url inválida" };
      cleanUrl = url.trim();
      if (cleanUrl.length === 0) return { error: "url não pode ser vazia" };
    }

    // follower range: se veio, valida; null limpa
    let cleanFollowerRange = undefined;
    if (has(payload, "id_follower_range")) {
      if (id_follower_range === null) {
        cleanFollowerRange = null;
      } else {
        if (!Number.isInteger(Number(id_follower_range)))
          return { error: "id_follower_range inválido" };
        cleanFollowerRange = Number(id_follower_range);
      }
    }

    // is_active: se veio, boolean
    let cleanIsActive = undefined;
    if (has(payload, "is_active")) {
      if (typeof is_active !== "boolean")
        return { error: "is_active inválido" };
      cleanIsActive = is_active;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const profile = await ProfileStorage.getProfileById(client, id_profile);
      if (!profile) {
        await client.query("ROLLBACK");
        return { error: "Perfil não encontrado" };
      }
      if (String(profile.id_user) !== String(user.id_user)) {
        await client.query("ROLLBACK");
        return { error: "Você não tem permissão para alterar este perfil" };
      }

      // valida follower range se veio number
      if (cleanFollowerRange !== undefined && cleanFollowerRange !== null) {
        const okRange = await SocialMediaStorage.followerRangeExistsActive(
          client,
          cleanFollowerRange
        );
        if (!okRange) {
          await client.query("ROLLBACK");
          return { error: "Faixa de seguidores não encontrada ou inativa" };
        }
      }

      const updated = await SocialMediaStorage.updateProfileSocialMediaByType(
        client,
        {
          id_profile,
          id_social_media_type: Number(id_social_media_type),
          payload: {
            ...(cleanUrl !== undefined ? { url: cleanUrl } : {}),
            ...(cleanFollowerRange !== undefined
              ? { id_follower_range: cleanFollowerRange }
              : {}),
            ...(cleanIsActive !== undefined
              ? { is_active: cleanIsActive }
              : {}),
          },
        }
      );

      if (!updated) {
        await client.query("ROLLBACK");
        return { error: "Rede social não encontrada para este perfil/tipo" };
      }

      await client.query("COMMIT");
      return {
        message: "Rede social atualizada com sucesso",
        social_media: updated,
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

  static async disableByType(user, params) {
    return runWithLogs(
      log,
      "disableByType",
      () => ({
        id_user: user?.id_user,
        id_profile: params?.id_profile,
        id_social_media_type: params?.id_social_media_type,
      }),
      async () => {
    const { id_profile, id_social_media_type } = params;

    if (!user?.id_user) return { error: "Não autenticado" };
    if (!id_profile || !UUID_RE.test(id_profile))
      return { error: "id_profile inválido" };
    if (!Number.isInteger(Number(id_social_media_type)))
      return { error: "id_social_media_type inválido" };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const profile = await ProfileStorage.getProfileById(client, id_profile);
      if (!profile) {
        await client.query("ROLLBACK");
        return { error: "Perfil não encontrado" };
      }
      if (String(profile.id_user) !== String(user.id_user)) {
        await client.query("ROLLBACK");
        return { error: "Você não tem permissão para alterar este perfil" };
      }

      const ok = await SocialMediaStorage.disableProfileSocialMediaByType(
        client,
        id_profile,
        Number(id_social_media_type)
      );
      if (!ok) {
        await client.query("ROLLBACK");
        return { error: "Rede social não encontrada para este perfil/tipo" };
      }

      await client.query("COMMIT");
      return { message: "Rede social desativada com sucesso" };
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

module.exports = SocialMediaService;
