// src/services/CommunityService.js
// Regras da Comunidade: criação (gate nível 5 + tetos), leitura, tema e
// entrada/saída de membros (Slice 2). Substitui o ClanService no novo conceito.

const pool = require("../databases");
const CommunityStorage = require("../storages/CommunityStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CommunityService");

const REQUIRED_LEVEL_TO_CREATE = 5;

class CommunityService {
  // ─── Criação ────────────────────────────────────────────────────────────────
  static async create(user, payload) {
    return runWithLogs(
      log,
      "create",
      () => ({ id_user: user?.id_user, id_machine: payload?.id_machine }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };

        const { display_name, id_machine, bio, avatar_url, theme } =
          payload || {};
        if (!display_name || !String(display_name).trim()) {
          return { error: "O nome da comunidade é obrigatório." };
        }
        if (!id_machine) return { error: "O enxame é obrigatório." };
        const bioStr = bio ? String(bio).trim() : null;
        if (bioStr && bioStr.length > 200) {
          return { error: "A bio deve ter no máximo 200 caracteres." };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          // 1. Requisito: ≥1 subperfil nível 5
          const sub = await CommunityStorage.getHighestSubprofile(
            client,
            id_user
          );
          if (sub.lvl < REQUIRED_LEVEL_TO_CREATE) {
            await client.query("ROLLBACK");
            return {
              error: `Você precisa de pelo menos um subperfil nível ${REQUIRED_LEVEL_TO_CREATE} para criar uma comunidade.`,
              required_level: REQUIRED_LEVEL_TO_CREATE,
              current_level: sub.lvl,
            };
          }

          // 2. Tetos de criação e participação
          const ent = await CommunityStorage.getEntitlement(client, id_user);
          const owned = await CommunityStorage.countOwned(client, id_user);
          if (owned >= ent.create_cap) {
            await client.query("ROLLBACK");
            return {
              error:
                "Limite de comunidades criadas atingido. Compre um ingresso para criar mais.",
              create_cap: ent.create_cap,
              owned,
            };
          }
          const memberships = await CommunityStorage.countMemberships(
            client,
            id_user
          );
          if (memberships >= ent.member_cap) {
            await client.query("ROLLBACK");
            return {
              error:
                "Limite de participação atingido. Compre um ingresso para entrar em mais comunidades.",
              member_cap: ent.member_cap,
              memberships,
            };
          }

          // 3. Cria perfil-comunidade (líder) + adiciona o user como líder
          const community = await CommunityStorage.createCommunity(client, {
            id_user,
            id_machine,
            display_name: String(display_name).trim(),
            bio: bioStr,
            avatar_url: avatar_url ?? null,
            theme: theme ?? null,
          });
          await CommunityStorage.addMember(
            client,
            community.id_profile,
            id_user,
            "leader"
          );

          await client.query("COMMIT");
          return community;
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* conexão pode estar inutilizável */
          }
          log.error("create.fail", { id_user, error: err.message });
          return { error: "Não foi possível criar a comunidade." };
        } finally {
          client.release();
        }
      }
    );
  }

  // ─── Leitura ─────────────────────────────────────────────────────────────────
  static async getById(params) {
    return runWithLogs(
      log,
      "getById",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const community = await CommunityStorage.getById(
          pool,
          params.id_profile
        );
        if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
        return { community };
      }
    );
  }

  static async listPublic(query) {
    return runWithLogs(
      log,
      "listPublic",
      () => ({ q: query?.q }),
      async () => {
        const communities = await CommunityStorage.listPublic(pool, {
          q: query?.q,
          id_machine: query?.id_machine,
          limit: query?.limit,
          offset: query?.offset,
        });
        return { communities };
      }
    );
  }

  static async getMembers(params) {
    return runWithLogs(
      log,
      "getMembers",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const members = await CommunityStorage.listMembers(
          pool,
          params.id_profile
        );
        return { members };
      }
    );
  }

  static async listMine(user) {
    return runWithLogs(
      log,
      "listMine",
      () => ({ id_user: user?.id_user }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const communities = await CommunityStorage.listForUser(pool, id_user);
        return { communities };
      }
    );
  }

  static async getFeed(params, query) {
    return runWithLogs(
      log,
      "getFeed",
      () => ({ id_profile: params?.id_profile, kind: query?.kind }),
      async () => {
        const kindRaw = query?.kind;
        const kind = kindRaw === "bees" || kindRaw === "feed" ? kindRaw : null;
        const items = await CommunityStorage.listItems(
          pool,
          params.id_profile,
          kind,
          query?.limit,
          query?.offset
        );
        return { items };
      }
    );
  }

  static async getCreationEligibility(user) {
    return runWithLogs(
      log,
      "getCreationEligibility",
      () => ({ id_user: user?.id_user }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const client = await pool.connect();
        try {
          const sub = await CommunityStorage.getHighestSubprofile(
            client,
            id_user
          );
          const ent = await CommunityStorage.getEntitlement(client, id_user);
          const owned = await CommunityStorage.countOwned(client, id_user);
          const memberships = await CommunityStorage.countMemberships(
            client,
            id_user
          );
          return {
            eligible:
              sub.lvl >= REQUIRED_LEVEL_TO_CREATE &&
              owned < ent.create_cap &&
              memberships < ent.member_cap,
            required_level: REQUIRED_LEVEL_TO_CREATE,
            current_level: sub.lvl,
            create_cap: ent.create_cap,
            member_cap: ent.member_cap,
            owned,
            memberships,
          };
        } finally {
          client.release();
        }
      }
    );
  }

  // ─── Tema (só líder) ──────────────────────────────────────────────────────────
  static async updateTheme(user, params, body) {
    return runWithLogs(
      log,
      "updateTheme",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
        if (String(community.id_leader_user) !== String(id_user)) {
          return { error: "Apenas o líder pode alterar o tema." };
        }
        const updated = await CommunityStorage.updateTheme(
          pool,
          params.id_profile,
          body?.theme ?? null
        );
        return updated;
      }
    );
  }

  // ─── Membros (Slice 2) ─────────────────────────────────────────────────────────
  static async join(user, params) {
    return runWithLogs(
      log,
      "join",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const community = await CommunityStorage.getById(
            client,
            params.id_profile
          );
          if (!community) {
            await client.query("ROLLBACK");
            return { error: "Comunidade não encontrada", statusCode: 404 };
          }

          const existing = await CommunityStorage.getMembership(
            client,
            params.id_profile,
            id_user
          );
          if (existing) {
            await client.query("COMMIT");
            return { ok: true, role: existing.role };
          }

          const sub = await CommunityStorage.getHighestSubprofile(
            client,
            id_user
          );
          if (!sub.has_subprofile) {
            await client.query("ROLLBACK");
            return {
              error: "Você precisa de pelo menos um subperfil para entrar.",
            };
          }

          const ent = await CommunityStorage.getEntitlement(client, id_user);
          const memberships = await CommunityStorage.countMemberships(
            client,
            id_user
          );
          if (memberships >= ent.member_cap) {
            await client.query("ROLLBACK");
            return {
              error:
                "Limite de participação atingido. Compre um ingresso para entrar em mais comunidades.",
              member_cap: ent.member_cap,
              memberships,
            };
          }

          await CommunityStorage.addMember(
            client,
            params.id_profile,
            id_user,
            "member"
          );
          await client.query("COMMIT");
          return { ok: true, role: "member" };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* noop */
          }
          log.error("join.fail", { id_user, error: err.message });
          return { error: "Não foi possível entrar na comunidade." };
        } finally {
          client.release();
        }
      }
    );
  }

  static async leave(user, params) {
    return runWithLogs(
      log,
      "leave",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const m = await CommunityStorage.getMembership(
          pool,
          params.id_profile,
          id_user
        );
        if (!m) return { ok: true };
        if (m.role === "leader") {
          return {
            error:
              "O líder não pode sair; transfira a liderança ou exclua a comunidade.",
          };
        }
        await CommunityStorage.removeMember(pool, params.id_profile, id_user);
        return { ok: true };
      }
    );
  }
}

module.exports = CommunityService;
