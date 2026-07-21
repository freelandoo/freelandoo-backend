// src/services/OnboardingService.js
// Fluxo pós-login para usuários que ainda não preencheram data de nascimento
// (caso típico: signup pelo Google, que não captura idade). Se a data
// indica menor de 18, exige código do responsável para vincular como
// conta supervisionada — tudo na mesma transação.

const pool = require("../databases");
const SupervisionService = require("./SupervisionService");
const SocialMediaStorage = require("../storages/SocialMediaStorage");
const { calculateAge } = require("../utils/validateSignup");
const { normalizeCPF } = require("../utils/documents");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("OnboardingService");

// Redes aceitas no onboarding (icon = coluna tb_social_media_type.icon, mig 000).
const ONBOARDING_SOCIAL_ICONS = new Set([
  "instagram", "tiktok", "youtube", "facebook", "twitter", "linkedin", "pinterest", "twitch",
]);

class OnboardingService {
  /**
   * Submete os dados de onboarding (data de nascimento + CPF + opcional código
   * parental). Cada campo só é exigido se ainda estiver vazio na conta — a
   * base antiga já tem nascimento e vai passar aqui só pelo CPF (mig 188).
   * Chamada com tudo já preenchido retorna erro.
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

        const current = await pool.query(
          `SELECT data_nascimento, cpf FROM public.tb_user WHERE id_user = $1 LIMIT 1`,
          [user.id_user],
        );
        if (!current.rowCount) return { error: "Usuário não encontrado" };
        const hasBirthdate = !!current.rows[0].data_nascimento;
        const hasCpf = !!current.rows[0].cpf;

        if (hasBirthdate && hasCpf) {
          return { error: "Onboarding já foi concluído" };
        }

        // Nascimento: só valida/grava se ainda falta. Quem já tem não pode
        // trocar por aqui (mudaria a idade e furaria o gate de menoridade).
        let age = null;
        if (!hasBirthdate) {
          if (!dataNascimento) {
            return { error: "Data de nascimento é obrigatória" };
          }
          age = calculateAge(dataNascimento);
          if (age == null || age < 0 || age > 120) {
            return { error: "Data de nascimento inválida" };
          }
        }

        // CPF: idem. Obrigatório, validado por dígito verificador e único.
        let cpf = null;
        if (!hasCpf) {
          if (!body?.cpf) {
            return { error: "CPF é obrigatório.", reason: "cpf_required" };
          }
          cpf = normalizeCPF(body.cpf);
          if (!cpf) {
            return { error: "CPF inválido.", reason: "cpf_invalid" };
          }
          const taken = await pool.query(
            `SELECT 1 FROM public.tb_user WHERE cpf = $1 AND id_user <> $2 LIMIT 1`,
            [cpf, user.id_user],
          );
          if (taken.rowCount) {
            return {
              error:
                "Este CPF já tem uma conta na Freelandoo. Use essa conta — dentro dela você pode criar quantos subperfis quiser.",
              reason: "cpf_taken",
            };
          }
        }

        // Vínculo parental só entra em jogo quando a idade está sendo definida
        // AGORA. Menor já supervisionado (base antiga) não é cobrado de novo.
        const isMinor = age != null && age < 18;
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
            `UPDATE tb_user
                SET data_nascimento = COALESCE($1, data_nascimento),
                    cpf             = COALESCE($2, cpf),
                    cpf_added_at    = CASE WHEN $2::char(11) IS NULL
                                           THEN cpf_added_at ELSE NOW() END,
                    updated_at      = NOW()
              WHERE id_user = $3`,
            [hasBirthdate ? null : dataNascimento, cpf, user.id_user],
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
            data_nascimento: hasBirthdate ? undefined : dataNascimento,
            cpf_saved: !!cpf,
          };
        } catch (err) {
          await client.query("ROLLBACK");
          // Duas abas do mesmo usuário (ou dois usuários) gravando o mesmo CPF
          // ao mesmo tempo: o UNIQUE parcial da mig 188 barra o segundo.
          if (err?.code === "23505" && String(err.constraint) === "ux_tb_user_cpf") {
            return {
              error:
                "Este CPF já tem uma conta na Freelandoo. Use essa conta — dentro dela você pode criar quantos subperfis quiser.",
              reason: "cpf_taken",
            };
          }
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
