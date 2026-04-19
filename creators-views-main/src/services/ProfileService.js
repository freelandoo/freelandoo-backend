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
        const { id_category, display_name, bio, avatar_url, estado, municipio } =
          payload;

        if (!id_user || !id_category || !display_name) {
          return {
            error: "Campos obrigatórios: id_user, id_category, display_name",
          };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

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

          const ok = await ProfileStorage.disableProfile(client, id_profile);
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
