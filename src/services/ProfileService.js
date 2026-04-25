const pool = require("../databases");
const ProfileStorage = require("../storages/ProfileStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProfileService");

class ProfileService {
  static async create(user, payload) {
    return runWithLogs(
      log,
      "create",
      () => ({ id_user: user?.id_user }),
      async () => {
        const id_user = user.id_user;
        const {
          id_machine,
          id_category,
          display_name,
          bio,
          avatar_url,
          estado,
          municipio,
        } = payload;

        if (!id_user || !id_machine || !id_category || !display_name) {
          return {
            error:
              "Campos obrigatórios: id_user, id_machine, id_category, display_name",
          };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const catRow = await client.query(
            `SELECT id_machine, is_active FROM public.tb_category WHERE id_category = $1 LIMIT 1`,
            [id_category]
          );
          if (!catRow.rowCount || !catRow.rows[0].is_active) {
            await client.query("ROLLBACK");
            return { error: "Profissão não encontrada ou inativa" };
          }
          if (Number(catRow.rows[0].id_machine) !== Number(id_machine)) {
            await client.query("ROLLBACK");
            return {
              error: "A profissão selecionada não pertence à máquina escolhida",
            };
          }

          const profile = await ProfileStorage.createProfile(client, {
            id_user,
            id_category,
            display_name,
            bio: bio || null,
            avatar_url: avatar_url || null,
            estado: estado || null,
            municipio: municipio || null,
          });

          const statuses = await ProfileStorage.listStatusesByProfile(
            client,
            profile.id_profile
          );

          await client.query("COMMIT");
          return {
            message: "Perfil criado com sucesso",
            profile: { ...profile, statuses },
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

  /**
   * Resolve perfil público pelo handle (username) e profession_slug.
   * Retorna mesmo payload que getById + city_slug e is_paid para canonicalização
   * server-side. Não faz checagem de visibilidade — o caller decide se renderiza
   * ou retorna 404 (rota SEO renderiza só se publicado).
   */
  static async getPublicByHandle(params) {
    return runWithLogs(
      log,
      "getPublicByHandle",
      () => ({
        handle: params?.handle,
        profession_slug: params?.profession_slug,
      }),
      async () => {
        const handle = String(params?.handle || "").replace(/^@/, "").trim();
        const profession_slug = String(params?.profession_slug || "").trim();
        if (!handle || !profession_slug) {
          return { error: "handle e profession_slug são obrigatórios" };
        }

        const profile =
          await ProfileStorage.getPublicProfileByHandleAndProfession(pool, {
            handle,
            profession_slug,
          });
        if (!profile) return { error: "Perfil não encontrado" };

        const subcategories = await ProfileStorage.listSubcategoriesByProfile(
          pool,
          profile.id_profile
        );
        const statuses = await ProfileStorage.listStatusesByProfile(
          pool,
          profile.id_profile
        );
        const social_media = await ProfileStorage.listSocialMediaByProfile(
          pool,
          profile.id_profile
        );

        const is_published =
          !!profile.is_paid && !!profile.is_visible && !profile.deleted_at;

        return {
          profile: {
            ...profile,
            subcategories,
            statuses,
            social_media,
            is_published,
          },
        };
      }
    );
  }

  /**
   * Resolve só pelo handle quando a URL não traz profession_slug. Retorna o
   * perfil "principal" (mais recente, publicado, ou primeiro disponível).
   * Usado para fallback quando alguém acessa apenas /@handle.
   */
  static async resolveCanonicalByHandle(params) {
    return runWithLogs(
      log,
      "resolveCanonicalByHandle",
      () => ({ handle: params?.handle }),
      async () => {
        const handle = String(params?.handle || "").replace(/^@/, "").trim();
        if (!handle) return { error: "handle é obrigatório" };

        const profiles = await ProfileStorage.listPublicProfilesByHandle(
          pool,
          handle
        );
        if (!profiles.length) return { error: "Perfil não encontrado" };

        // Prefere perfil publicado (paid + visible); fallback no primeiro
        const canonical =
          profiles.find((p) => p.is_paid && p.is_visible && !p.deleted_at) ||
          profiles[0];

        return { profile: canonical };
      }
    );
  }

  static async getById(params) {
    return runWithLogs(
      log,
      "getById",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const { id_profile } = params;
        if (!id_profile) return { error: "id_profile é obrigatório" };

        const profile = await ProfileStorage.getProfileById(pool, id_profile);
        if (!profile) return { error: "Perfil não encontrado" };

        const subcategories = await ProfileStorage.listSubcategoriesByProfile(
          pool,
          id_profile
        );
        const statuses = await ProfileStorage.listStatusesByProfile(
          pool,
          id_profile
        );
        const social_media = await ProfileStorage.listSocialMediaByProfile(
          pool,
          id_profile
        );

        return {
          profile: {
            ...profile,
            subcategories,
            statuses,
            social_media,
          },
        };
      }
    );
  }

  static async update(user, params, payload) {
    return runWithLogs(
      log,
      "update",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const UUID_RE =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

        const { id_profile } = params;
        if (!id_profile || !UUID_RE.test(id_profile))
          return { error: "id_profile inválido" };

        const hasAnyField = [
          "id_category",
          "display_name",
          "bio",
          "avatar_url",
          "estado",
          "municipio",
          "is_active",
          "subcategories",
        ].some((k) => Object.prototype.hasOwnProperty.call(payload, k));

        if (!hasAnyField) return { error: "Nenhum campo para atualizar" };

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const before = await ProfileStorage.getProfileById(client, id_profile);
          if (!before) {
            await client.query("ROLLBACK");
            return { error: "Perfil não encontrado" };
          }

          if (user?.id_user && String(before.id_user) !== String(user.id_user)) {
            await client.query("ROLLBACK");
            return { error: "Você não tem permissão para alterar este perfil" };
          }

          let finalCategory = before.id_category;
          if (Object.prototype.hasOwnProperty.call(payload, "id_category")) {
            const nextCategory = Number(payload.id_category);
            if (!Number.isInteger(nextCategory)) {
              await client.query("ROLLBACK");
              return { error: "id_category inválido" };
            }

            const okCat = await ProfileStorage.categoryExistsActive(
              client,
              nextCategory
            );
            if (!okCat) {
              await client.query("ROLLBACK");
              return { error: "Categoria não encontrada ou inativa" };
            }

            finalCategory = nextCategory;
          }

          const updated = await ProfileStorage.updateProfile(
            client,
            id_profile,
            payload
          );
          if (!updated) {
            await client.query("ROLLBACK");
            return { error: "Perfil não encontrado" };
          }

          const categoryChanged =
            Object.prototype.hasOwnProperty.call(payload, "id_category") &&
            Number(before.id_category) !== Number(finalCategory);

          if (Object.prototype.hasOwnProperty.call(payload, "subcategories")) {
            const { subcategories } = payload;

            if (!Array.isArray(subcategories)) {
              await client.query("ROLLBACK");
              return { error: "subcategories deve ser um array" };
            }

            const clean = [...new Set(subcategories.map(Number))].filter(
              Number.isInteger
            );

            await ProfileStorage.clearProfileSubcategories(client, id_profile);

            if (clean.length > 0) {
              const valid =
                await ProfileStorage.validateSubcategoriesBelongToCategory(
                  client,
                  clean,
                  Number(finalCategory)
                );

              if (!valid.ok) {
                await client.query("ROLLBACK");
                return {
                  error:
                    "Uma ou mais subcategorias não pertencem à categoria selecionada",
                  invalid_subcategories: valid.invalid_subcategories,
                };
              }

              for (const id_subcategory of clean) {
                await ProfileStorage.insertProfileSubcategory(client, {
                  id_profile,
                  id_subcategory,
                });
              }
            }
          } else if (categoryChanged) {
            await ProfileStorage.clearProfileSubcategories(client, id_profile);
          }

          await client.query("COMMIT");

          const subcategories = await ProfileStorage.listSubcategoriesByProfile(
            client,
            id_profile
          );
          const statuses = await ProfileStorage.listStatusesByProfile(
            client,
            id_profile
          );
          const social_media = await ProfileStorage.listSocialMediaByProfile(
            client,
            id_profile
          );

          return {
            message: "Perfil atualizado com sucesso",
            profile: { ...updated, subcategories, statuses, social_media },
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

  static async remove(user, params) {
    return runWithLogs(
      log,
      "remove",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const { id_profile } = params;
        if (!id_profile) return { error: "id_profile é obrigatório" };

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const profile = await ProfileStorage.getProfileById(client, id_profile);
          if (!profile) {
            await client.query("ROLLBACK");
            return { error: "Perfil não encontrado" };
          }

          if (
            !user?.id_user ||
            String(profile.id_user) !== String(user.id_user)
          ) {
            await client.query("ROLLBACK");
            return { error: "Você não tem permissão para alterar este perfil" };
          }

          if (profile.deleted_at) {
            await client.query("ROLLBACK");
            return { error: "Perfil já foi removido" };
          }

          const ok = await ProfileStorage.softDeleteProfile(client, id_profile);
          if (!ok) {
            await client.query("ROLLBACK");
            return { error: "Perfil não encontrado" };
          }

          await client.query("COMMIT");
          return { message: "Perfil removido com sucesso" };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }

  static async listByUser(params) {
    return runWithLogs(
      log,
      "listByUser",
      () => ({ id_user: params?.id_user }),
      async () => {
        const { id_user } = params;
        if (!id_user) return { error: "id_user é obrigatório" };

        const profiles = await ProfileStorage.listProfilesByUser(pool, id_user);
        return { profiles };
      }
    );
  }

  static async setVisibility(user, params, payload) {
    return runWithLogs(
      log,
      "setVisibility",
      () => ({
        id_user: user?.id_user,
        id_profile: params?.id_profile,
        is_visible: payload?.is_visible,
      }),
      async () => {
        const { id_profile } = params;
        const { is_visible } = payload || {};

        if (!id_profile) return { error: "id_profile é obrigatório" };
        if (typeof is_visible !== "boolean") {
          return { error: "is_visible deve ser boolean" };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const profile = await ProfileStorage.getProfileById(client, id_profile);
          if (!profile || profile.deleted_at) {
            await client.query("ROLLBACK");
            return { error: "Perfil não encontrado" };
          }
          if (String(profile.id_user) !== String(user.id_user)) {
            await client.query("ROLLBACK");
            return { error: "Você não tem permissão para alterar este perfil" };
          }

          if (is_visible) {
            const subRes = await client.query(
              `SELECT 1 FROM tb_profile_subscription
                WHERE id_profile = $1 AND status = 'active' LIMIT 1`,
              [id_profile]
            );
            if (subRes.rowCount === 0) {
              await client.query("ROLLBACK");
              return {
                error:
                  "Para tornar o perfil visível é necessário ter uma assinatura ativa",
              };
            }
          }

          const updated = await ProfileStorage.setVisibility(
            client,
            id_profile,
            is_visible
          );
          if (!updated) {
            await client.query("ROLLBACK");
            return { error: "Perfil não encontrado" };
          }

          await client.query("COMMIT");
          return {
            message: is_visible
              ? "Perfil agora está visível nas buscas"
              : "Perfil agora está invisível nas buscas",
            profile: updated,
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

  static async setStatus(user, params, payload) {
    return runWithLogs(
      log,
      "setStatus",
      () => ({
        id_user: user?.id_user,
        id_profile: params?.id_profile,
        id_status: payload?.id_status,
      }),
      async () => {
        const { id_profile } = params;
        const { id_status } = payload;

        if (!id_profile || !id_status)
          return { error: "Campos obrigatórios: id_profile, id_status" };

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

          await ProfileStorage.clearProfileStatuses(client, id_profile);
          await ProfileStorage.insertProfileStatus(client, {
            id_profile,
            id_status,
            created_by: user.id_user,
          });

          await client.query("COMMIT");
          return { message: "Status do perfil atualizado com sucesso" };
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

module.exports = ProfileService;
