const pool = require("../databases");
const EntityFollowStorage = require("../storages/EntityFollowStorage");
const XpStorage = require("../storages/XpStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("EntityFollowService");

function normalizeEntityParams(source = {}) {
  return {
    entity_type: EntityFollowStorage.normalizeType(
      source.entity_type || source.type || source.target_type
    ),
    entity_id: source.entity_id || source.id || source.target_id,
  };
}

function labelsFor(entity_type) {
  return {
    followers_label:
      entity_type === "clan"
        ? "acompanham este clan"
        : "acompanham este perfil",
    following_label: "acompanhados",
  };
}

function mapEntity(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    display_name: row.display_name,
    bio: row.bio,
    avatar_url: row.avatar_url,
    estado: row.estado,
    municipio: row.municipio,
    username: row.username,
    sub_profile_slug: row.sub_profile_slug,
    profession_name: row.profession_name,
    profession_slug: row.profession_slug,
    machine_name: row.machine_name,
    machine_slug: row.machine_slug,
    members_count: row.members_count,
    followed_at: row.followed_at || null,
  };
}

async function resolveActor(conn, user, payload = {}) {
  const actor_type = EntityFollowStorage.normalizeType(
    payload.actor_type || payload.follower_type
  );
  const actor_id = payload.actor_id || payload.follower_id;

  if (!user?.id_user) return { error: "Usuário não autenticado" };
  if (!actor_type || !actor_id) {
    return { error: "ator do acompanhamento é obrigatório" };
  }

  const actor =
    actor_type === "clan"
      ? await EntityFollowStorage.getClanActor(conn, {
          id_user: user.id_user,
          id_profile: actor_id,
        })
      : await EntityFollowStorage.getProfileActor(conn, {
          id_user: user.id_user,
          id_profile: actor_id,
        });

  if (!actor) return { error: "Sem permissão para acompanhar por esta entidade" };
  if (!EntityFollowStorage.isPublicEntity(actor)) {
    return { error: "Entidade ativa e publicada é obrigatória" };
  }

  return {
    actor_type,
    actor_id,
    actor,
  };
}

class EntityFollowService {
  static async listActors(user) {
    return runWithLogs(
      log,
      "listActors",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const actors = await EntityFollowStorage.listActorOptions(
          pool,
          user.id_user
        );
        return { actors: actors.map(mapEntity).filter(Boolean) };
      }
    );
  }

  static async follow(user, payload) {
    return runWithLogs(
      log,
      "follow",
      () => ({
        id_user: user?.id_user,
        actor_type: payload?.actor_type || payload?.follower_type,
        target_type: payload?.target_type,
      }),
      async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const actorRes = await resolveActor(client, user, payload);
          if (actorRes.error) {
            await client.query("ROLLBACK");
            return actorRes;
          }

          const target_type = EntityFollowStorage.normalizeType(
            payload?.target_type
          );
          const target_id = payload?.target_id;
          if (!target_type || !target_id) {
            await client.query("ROLLBACK");
            return { error: "target_type e target_id são obrigatórios" };
          }

          if (
            actorRes.actor_type === target_type &&
            String(actorRes.actor_id) === String(target_id)
          ) {
            await client.query("ROLLBACK");
            return { error: "Entidade não pode acompanhar ela mesma" };
          }

          const target = await EntityFollowStorage.getEntity(client, {
            type: target_type,
            id: target_id,
          });
          if (!target) {
            await client.query("ROLLBACK");
            return { error: "Entidade não encontrada" };
          }
          if (!EntityFollowStorage.isPublicEntity(target)) {
            await client.query("ROLLBACK");
            return { error: "Entidade não pode ser acompanhada" };
          }

          const follow = await EntityFollowStorage.upsertActive(client, {
            follower_type: actorRes.actor_type,
            follower_id: actorRes.actor_id,
            target_type,
            target_id,
          });
          const counts = await EntityFollowStorage.counts(client, {
            entity_type: target_type,
            entity_id: target_id,
          });

          await client.query("COMMIT");

          // XP por acompanhamento recebido — somente para subperfis (não clans)
          // source_id garante que follow/unfollow/follow não duplica XP
          if (target_type === "profile") {
            XpStorage.award(pool, {
              id_profile: target_id,
              event_type: "follow_received",
              source_type: "entity_follow",
              source_id: `${actorRes.actor_id}_${target_id}`,
            }).catch(() => {});
          }

          return {
            is_following: true,
            follow,
            actor: mapEntity(actorRes.actor),
            target: mapEntity(target),
            counts: {
              ...counts,
              ...labelsFor(target_type),
            },
          };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
    );
  }

  static async unfollow(user, payload) {
    return runWithLogs(
      log,
      "unfollow",
      () => ({
        id_user: user?.id_user,
        actor_type: payload?.actor_type || payload?.follower_type,
        target_type: payload?.target_type,
      }),
      async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const actorRes = await resolveActor(client, user, payload);
          if (actorRes.error) {
            await client.query("ROLLBACK");
            return actorRes;
          }

          const target_type = EntityFollowStorage.normalizeType(
            payload?.target_type
          );
          const target_id = payload?.target_id;
          if (!target_type || !target_id) {
            await client.query("ROLLBACK");
            return { error: "target_type e target_id são obrigatórios" };
          }

          const follow = await EntityFollowStorage.softDelete(client, {
            follower_type: actorRes.actor_type,
            follower_id: actorRes.actor_id,
            target_type,
            target_id,
          });
          const counts = await EntityFollowStorage.counts(client, {
            entity_type: target_type,
            entity_id: target_id,
          });

          await client.query("COMMIT");
          return {
            is_following: false,
            changed: !!follow,
            counts: {
              ...counts,
              ...labelsFor(target_type),
            },
          };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
    );
  }

  static async status(user, query) {
    return runWithLogs(
      log,
      "status",
      () => ({
        id_user: user?.id_user,
        actor_type: query?.actor_type || query?.follower_type,
        target_type: query?.target_type,
      }),
      async () => {
        const actorRes = await resolveActor(pool, user, query);
        if (actorRes.error) return { is_following: false, reason: actorRes.error };

        const target_type = EntityFollowStorage.normalizeType(
          query?.target_type
        );
        const target_id = query?.target_id;
        if (!target_type || !target_id) {
          return { error: "target_type e target_id são obrigatórios" };
        }

        const follow = await EntityFollowStorage.findActive(pool, {
          follower_type: actorRes.actor_type,
          follower_id: actorRes.actor_id,
          target_type,
          target_id,
        });
        return {
          is_following: !!follow,
          actor: mapEntity(actorRes.actor),
        };
      }
    );
  }

  static async counts(query) {
    return runWithLogs(
      log,
      "counts",
      () => ({
        entity_type: query?.entity_type,
        entity_id: query?.entity_id,
      }),
      async () => {
        const { entity_type, entity_id } = normalizeEntityParams(query);
        if (!entity_type || !entity_id) {
          return { error: "entity_type e entity_id são obrigatórios" };
        }

        const entity = await EntityFollowStorage.getEntity(pool, {
          type: entity_type,
          id: entity_id,
        });
        if (!entity) return { error: "Entidade não encontrada" };

        const counts = await EntityFollowStorage.counts(pool, {
          entity_type,
          entity_id,
        });
        return {
          ...counts,
          ...labelsFor(entity_type),
        };
      }
    );
  }

  static async followers(query) {
    return runWithLogs(
      log,
      "followers",
      () => ({
        entity_type: query?.entity_type,
        entity_id: query?.entity_id,
      }),
      async () => {
        const { entity_type, entity_id } = normalizeEntityParams(query);
        if (!entity_type || !entity_id) {
          return { error: "entity_type e entity_id são obrigatórios" };
        }

        const result = await EntityFollowStorage.listFollowers(pool, {
          entity_type,
          entity_id,
          cursor: query?.cursor,
          limit: query?.limit,
        });
        return {
          ...result,
          title: "Acompanham",
          items: result.items.map(mapEntity).filter(Boolean),
        };
      }
    );
  }

  static async following(query) {
    return runWithLogs(
      log,
      "following",
      () => ({
        entity_type: query?.entity_type,
        entity_id: query?.entity_id,
      }),
      async () => {
        const { entity_type, entity_id } = normalizeEntityParams(query);
        if (!entity_type || !entity_id) {
          return { error: "entity_type e entity_id são obrigatórios" };
        }

        const result = await EntityFollowStorage.listFollowing(pool, {
          entity_type,
          entity_id,
          cursor: query?.cursor,
          limit: query?.limit,
        });
        return {
          ...result,
          title: "Acompanhados",
          items: result.items.map(mapEntity).filter(Boolean),
        };
      }
    );
  }
}

module.exports = EntityFollowService;
