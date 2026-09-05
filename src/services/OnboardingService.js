// src/services/OnboardingService.js
// Fluxo pós-login para usuários que ainda não completaram o cadastro. Cobre
// dois passos, resolvidos numa única submissão (o modal do front é wizard, a
// API é atômica):
//   passo 1 — identidade: data de nascimento (signup pelo Google não captura)
//             e CPF (mig 188). Menor de 18 exige código do responsável.
//   passo 2 — taxonomia: enxame + profissão + cidade, gravados no PERFIL-CONTA
//             (mig 200). É o que tira a conta da "categoria fantasma".
// Cada campo só é exigido se ainda estiver vazio — a base antiga passa aqui só
// pelo que falta.

const pool = require("../databases");
const SupervisionService = require("./SupervisionService");
const FraudService = require("./FraudService");
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
   * parental + enxame/profissão/cidade do perfil-conta). Cada campo só é
   * exigido se ainda estiver vazio na conta — a base antiga já tem nascimento e
   * vai passar aqui pelo CPF (mig 188) e pela taxonomia (mig 200).
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

        // Perfil-conta: alvo do passo 2. Pode não existir em conta muito antiga
        // (ensureUserAccountProfile só roda no signup/login) — nesse caso a
        // taxonomia é pulada em vez de travar o usuário fora do site.
        const accountProfile = await pool.query(
          `SELECT id_profile, taxonomy_declared_at
             FROM public.tb_profile
            WHERE id_user = $1 AND is_user_account = TRUE AND deleted_at IS NULL
            LIMIT 1`,
          [user.id_user],
        );
        const accountProfileId = accountProfile.rows[0]?.id_profile || null;
        const hasTaxonomy =
          !accountProfileId || !!accountProfile.rows[0].taxonomy_declared_at;

        if (hasBirthdate && hasCpf && hasTaxonomy) {
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
                "Este CPF já tem uma conta na Freelandoo. Use essa conta — dentro dela você pode criar quantos perfis quiser.",
              reason: "cpf_taken",
            };
          }
        }

        // Taxonomia do perfil-conta (mig 200): enxame + profissão + cidade.
        // Só exigida de quem ainda não declarou; a validação espelha
        // ProfileService.create (categoria ativa e pertencente ao enxame).
        let taxonomy = null;
        if (!hasTaxonomy) {
          const id_machine = Number(body?.id_machine);
          const id_category = Number(body?.id_category);
          const estado =
            typeof body?.estado === "string" ? body.estado.trim().toUpperCase() : "";
          const municipio =
            typeof body?.municipio === "string" ? body.municipio.trim() : "";

          if (!Number.isInteger(id_machine) || id_machine <= 0) {
            return { error: "Selecione um enxame.", reason: "machine_required" };
          }
          if (!Number.isInteger(id_category) || id_category <= 0) {
            return {
              error: "Selecione uma profissão.",
              reason: "category_required",
            };
          }
          if (!/^[A-Z]{2}$/.test(estado) || !municipio) {
            return {
              error: "Selecione seu estado e sua cidade.",
              reason: "city_required",
            };
          }

          const catRow = await pool.query(
            `SELECT id_machine, is_active
               FROM public.tb_category WHERE id_category = $1 LIMIT 1`,
            [id_category],
          );
          if (!catRow.rowCount || !catRow.rows[0].is_active) {
            return { error: "Profissão não encontrada ou inativa" };
          }
          if (Number(catRow.rows[0].id_machine) !== id_machine) {
            return {
              error: "A profissão selecionada não pertence ao enxame escolhido",
            };
          }

          taxonomy = {
            id_category,
            estado,
            municipio: municipio.slice(0, 120),
          };
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

          // Passo 2: taxonomia + cidade no perfil-conta. id_region é resolvido
          // pela tb_region_city (mesma expressão do ProfileStorage) — fica NULL
          // se a cidade ainda não estiver mapeada, sem quebrar o cadastro.
          if (taxonomy && accountProfileId) {
            await client.query(
              `UPDATE public.tb_profile
                  SET id_category          = $1,
                      estado               = $2::text,
                      municipio            = $3::text,
                      id_region            = (
                        SELECT rc.id_region FROM public.tb_region_city rc
                         WHERE rc.uf = $2::text
                           AND rc.municipio_norm = fl_norm_city($3::text)
                      ),
                      taxonomy_declared_at = NOW(),
                      updated_at           = NOW()
                WHERE id_profile = $4`,
              [
                taxonomy.id_category,
                taxonomy.estado,
                taxonomy.municipio,
                accountProfileId,
              ],
            );
          }

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

          // Reavaliação antifraude (mig 201): é AQUI que CPF e cidade chegam no
          // fluxo do Google, e sem eles o sinal de região fiscal do CPF não
          // tinha o que comparar. Fire-and-forget — só enfileira revisão humana.
          FraudService.evaluateUser(user.id_user).catch(() => {});

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
            taxonomy_saved: !!taxonomy,
          };
        } catch (err) {
          await client.query("ROLLBACK");
          // Duas abas do mesmo usuário (ou dois usuários) gravando o mesmo CPF
          // ao mesmo tempo: o UNIQUE parcial da mig 188 barra o segundo.
          if (err?.code === "23505" && String(err.constraint) === "ux_tb_user_cpf") {
            return {
              error:
                "Este CPF já tem uma conta na Freelandoo. Use essa conta — dentro dela você pode criar quantos perfis quiser.",
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
