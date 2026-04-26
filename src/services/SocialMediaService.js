const pool = require("../databases");
const SocialMediaStorage = require("../storages/SocialMediaStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("SocialMediaService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj || {}, k);

const WHATSAPP_DEFAULT_MESSAGE = "Oi, eu sou da Freelandoo. Você pode conversar agora?";

async function getSocialTypeIcon(conn, id_social_media_type) {
  const r = await conn.query(
    `SELECT icon FROM public.tb_social_media_type WHERE id_social_media_type = $1 LIMIT 1`,
    [id_social_media_type]
  );
  return r.rows[0]?.icon || null;
}

function normalizeWhatsappPhone(raw) {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null; // sem DDD/país suficiente
  // Se já começa com 55 e tem 12-13 dígitos, mantém
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  // Se tem 10 ou 11 dígitos (DDD + número), prepend 55 BR
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  // Outro formato com country code; aceita até 15 dígitos (E.164 max)
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

function buildWhatsappUrl(normalizedPhone) {
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(WHATSAPP_DEFAULT_MESSAGE)}`;
}

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
    const { id_social_media_type, url, id_follower_range, phone_number } = payload;

    if (!user?.id_user) return { error: "Não autenticado" };
    if (!id_profile || !UUID_RE.test(id_profile))
      return { error: "id_profile inválido" };
    if (!Number.isInteger(Number(id_social_media_type)))
      return { error: "id_social_media_type inválido" };

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

      const typeIcon = await getSocialTypeIcon(client, Number(id_social_media_type));
      const isWhatsapp = typeIcon === "whatsapp";

      // ─── Tratamento WhatsApp ─────────────────────────────────────
      let cleanUrl;
      let cleanPhoneNormalized;
      if (isWhatsapp) {
        if (!phone_number || typeof phone_number !== "string") {
          await client.query("ROLLBACK");
          return { error: "Número de telefone é obrigatório para WhatsApp" };
        }
        const normalized = normalizeWhatsappPhone(phone_number);
        if (!normalized) {
          await client.query("ROLLBACK");
          return { error: "Número de telefone inválido" };
        }
        cleanPhoneNormalized = normalized;
        cleanUrl = buildWhatsappUrl(normalized);
      } else {
        // ✅ url: se vier, precisa ser string não vazia
        if (url !== undefined && url !== null) {
          if (typeof url !== "string") {
            await client.query("ROLLBACK");
            return { error: "url inválida" };
          }
          const trimmed = url.trim();
          if (trimmed.length === 0) {
            await client.query("ROLLBACK");
            return { error: "url não pode ser vazia" };
          }
          cleanUrl = trimmed;
        }
      }

      // valida follower range se veio (não exigido para whatsapp)
      let cleanFollowerRange = undefined;
      if (id_follower_range !== undefined) {
        if (id_follower_range === null) {
          cleanFollowerRange = null;
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

      const row = await SocialMediaStorage.upsertProfileSocialMedia(client, {
        id_profile,
        id_social_media_type: Number(id_social_media_type),
        url: cleanUrl,
        id_follower_range: cleanFollowerRange,
        phone_number_normalized: cleanPhoneNormalized,
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
    const { url, id_follower_range, is_active, phone_number } = payload;

    if (!user?.id_user) return { error: "Não autenticado" };
    if (!id_profile || !UUID_RE.test(id_profile))
      return { error: "id_profile inválido" };
    if (!Number.isInteger(Number(id_social_media_type)))
      return { error: "id_social_media_type inválido" };

    const hasAny = ["url", "id_follower_range", "is_active", "phone_number"].some((k) =>
      has(payload, k)
    );
    if (!hasAny) return { error: "Nenhum campo para atualizar" };

    const typeIcon = await getSocialTypeIcon(pool, Number(id_social_media_type));
    const isWhatsapp = typeIcon === "whatsapp";

    // WhatsApp: phone_number sobrescreve url
    let cleanUrl = undefined;
    let cleanPhoneNormalized = undefined;
    if (isWhatsapp && has(payload, "phone_number")) {
      if (!phone_number || typeof phone_number !== "string") return { error: "Número de telefone inválido" };
      const normalized = normalizeWhatsappPhone(phone_number);
      if (!normalized) return { error: "Número de telefone inválido" };
      cleanPhoneNormalized = normalized;
      cleanUrl = buildWhatsappUrl(normalized);
    } else if (has(payload, "url")) {
      if (url === null) return { error: "url não pode ser null" };
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
            ...(cleanPhoneNormalized !== undefined
              ? { phone_number_normalized: cleanPhoneNormalized }
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
