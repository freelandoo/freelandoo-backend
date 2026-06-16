// src/services/OnboardingService.js
// Fluxo pós-login para usuários que ainda não preencheram data de nascimento
// (caso típico: signup pelo Google, que não captura idade). Se a data
// indica menor de 18, exige código do responsável para vincular como
// conta supervisionada — tudo na mesma transação.

const pool = require("../databases");
const SupervisionService = require("./SupervisionService");
const SupervisionStorage = require("../storages/SupervisionStorage");
const SocialMediaStorage = require("../storages/SocialMediaStorage");
const { calculateAge } = require("../utils/validateSignup");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("OnboardingService");

// Redes aceitas no onboarding (icon = coluna tb_social_media_type.icon, mig 000).
const ONBOARDING_SOCIAL_ICONS = new Set([
  "instagram", "tiktok", "youtube", "facebook", "twitter", "linkedin", "pinterest", "twitch",
]);

class OnboardingService {
  /**
   * Submete os dados de onboarding (data de nascimento + opcional código
   * parental). Só funciona se o user ainda não tem data_nascimento setada
   * — chamada subsequente retorna erro.
   */
  static async submitBirthdate(user, body) {
    return runWithLogs(
      log,
      "submitBirthdate",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };

        const dataNascimento =
          typeof body?.data_nascimento === "string" &&
          body.data_nascimento.trim()
            ? body.data_nascimento.trim()
            : null;
        const responsibleCode =
          typeof body?.responsible_code === "string" &&
          body.responsible_code.trim()
            ? body.responsible_code.trim().toUpperCase()
            : null;

        if (!dataNascimento) {
          return { error: "Data de nascimento é obrigatória" };
        }
        const age = calculateAge(dataNascimento);
        if (age == null || age < 0 || age > 120) {
          return { error: "Data de nascimento inválida" };
        }

        const flags = await SupervisionStorage.getUserMinorFlags(
          pool,
          user.id_user,
        );
        if (flags?.data_nascimento) {
          return { error: "Onboarding já foi concluído" };
        }

        const isMinor = age < 18;
        if (isMinor && !responsibleCode) {
          return {
            error:
              "Conta menor de 18 anos exige código do responsável.",
            reason: "responsible_code_required",
          };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `UPDATE tb_user SET data_nascimento = $1, updated_at = NOW()
              WHERE id_user = $2`,
            [dataNascimento, user.id_user],
          );

          if (isMinor) {
            const consumed = await SupervisionService.consumeInviteForSignup(
              client,
              { code: responsibleCode, minorUserId: user.id_user },
            );
            if (consumed?.error) {
              await client.query("ROLLBACK");
              return { error: consumed.error };
            }
          }

          await client.query("COMMIT");

          // Redes sociais do onboarding (opcionais) — best-effort, NÃO bloqueia
          // o cadastro se falhar. Salvas no perfil-conta do usuário.
          await this._saveOnboardingSocialLinks(
            user.id_user,
            body?.social_links,
          ).catch((err) =>
            log.error("submitBirthdate.socialLinks.fail", {
              id_user: user.id_user,
              error: err.message,
            }),
          );

          return {
            ok: true,
            is_minor: isMinor,
            data_nascimento: dataNascimento,
          };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
    );
  }

  // Salva as redes (icon + url) no perfil-conta (is_user_account) do usuário.
  // Tolerante: ignora itens inválidos; resolve o tipo pelo icon; prefixa https://
  // quando o usuário cola só o domínio. Transação própria (separada do birthdate).
  static async _saveOnboardingSocialLinks(id_user, rawLinks) {
    if (!Array.isArray(rawLinks) || rawLinks.length === 0) return;

    const clean = [];
    for (const link of rawLinks) {
      const icon =
        typeof link?.icon === "string" ? link.icon.trim().toLowerCase() : null;
      let url = typeof link?.url === "string" ? link.url.trim() : null;
      if (!icon || !url || !ONBOARDING_SOCIAL_ICONS.has(icon)) continue;
      if (url.length > 500) url = url.slice(0, 500);
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      clean.push({ icon, url });
    }
    if (clean.length === 0) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const prof = await client.query(
        `SELECT id_profile FROM public.tb_profile
          WHERE id_user = $1 AND is_user_account = TRUE AND deleted_at IS NULL
          LIMIT 1`,
        [id_user],
      );
      const id_profile = prof.rows[0]?.id_profile;
      if (!id_profile) {
        await client.query("ROLLBACK");
        return;
      }
      for (const { icon, url } of clean) {
        const tr = await client.query(
          `SELECT id_social_media_type FROM public.tb_social_media_type
            WHERE icon = $1 AND is_active = true LIMIT 1`,
          [icon],
        );
        const id_social_media_type = tr.rows[0]?.id_social_media_type;
        if (!id_social_media_type) continue;
        await SocialMediaStorage.upsertProfileSocialMedia(client, {
          id_profile,
          id_social_media_type,
          url,
          id_follower_range: null,
          phone_number_normalized: null,
        });
      }
      await client.query("COMMIT");
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* conexão pode estar inutilizável */
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = OnboardingService;
