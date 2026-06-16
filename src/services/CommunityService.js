// src/services/CommunityService.js
// Regras da Comunidade: criação (gate nível 5 + tetos), leitura, tema e
// entrada/saída de membros (Slice 2). Substitui o ClanService no novo conceito.

const pool = require("../databases");
const CommunityStorage = require("../storages/CommunityStorage");
const PortfolioFeedService = require("./portfolioFeed/PortfolioFeedService");
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

  // ─── Edição de perfil (só líder) ──────────────────────────────────────────────
  // Guard reutilizável: carrega a comunidade e confirma que o user é o líder.
  static async _assertLeader(id_user, id_profile) {
    if (!id_user) return { error: "Usuário não autenticado" };
    const community = await CommunityStorage.getById(pool, id_profile);
    if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
    if (String(community.id_leader_user) !== String(id_user)) {
      return { error: "Apenas o líder pode editar a comunidade." };
    }
    return { community };
  }

  static async updateProfile(user, params, body) {
    return runWithLogs(
      log,
      "updateProfile",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const guard = await this._assertLeader(user?.id_user, params?.id_profile);
        if (guard.error) return guard;

        const patch = {};
        if (body?.display_name !== undefined) {
          const name = String(body.display_name || "").trim();
          if (!name) return { error: "O nome da comunidade é obrigatório." };
          if (name.length > 80) {
            return { error: "O nome deve ter no máximo 80 caracteres." };
          }
          patch.display_name = name;
        }
        if (body?.bio !== undefined) {
          const bio = body.bio ? String(body.bio).trim() : null;
          if (bio && bio.length > 200) {
            return { error: "A bio deve ter no máximo 200 caracteres." };
          }
          patch.bio = bio;
        }
        if (Object.keys(patch).length === 0) {
          return { error: "Nada para atualizar." };
        }
        const updated = await CommunityStorage.updateProfile(
          pool,
          params.id_profile,
          patch
        );
        return updated || { error: "Comunidade não encontrada", statusCode: 404 };
      }
    );
  }

  // Persiste a URL já enviada ao R2 (o controller faz o upload).
  static async setAvatar(user, params, avatar_url) {
    return runWithLogs(
      log,
      "setAvatar",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const guard = await this._assertLeader(user?.id_user, params?.id_profile);
        if (guard.error) return guard;
        const updated = await CommunityStorage.setAvatar(
          pool,
          params.id_profile,
          avatar_url
        );
        return updated || { error: "Comunidade não encontrada", statusCode: 404 };
      }
    );
  }

  static async setBanner(user, params, banner_url) {
    return runWithLogs(
      log,
      "setBanner",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const guard = await this._assertLeader(user?.id_user, params?.id_profile);
        if (guard.error) return guard;
        const updated = await CommunityStorage.setBanner(
          pool,
          params.id_profile,
          banner_url
        );
        return updated || { error: "Comunidade não encontrada", statusCode: 404 };
      }
    );
  }

  // ─── Feed estilo grupo (posts dos membros) ──────────────────────────────────
  // Feed unificado (posts + bees), cronológico, no shape FeedPost do /feed.
  static async getFeedPosts(params, query, viewer) {
    return runWithLogs(
      log,
      "getFeedPosts",
      () => ({ id_profile: params?.id_profile, cursor: query?.cursor || null }),
      async () => {
        let before_ts = null;
        let before_id = null;
        if (query?.cursor) {
          try {
            const decoded = Buffer.from(String(query.cursor), "base64").toString("utf8");
            const sep = decoded.lastIndexOf("|");
            if (sep > 0) {
              before_ts = decoded.slice(0, sep);
              before_id = decoded.slice(sep + 1);
            }
          } catch {
            /* cursor inválido — começa do início */
          }
        }
        const limit = Math.min(Math.max(Number(query?.limit) || 12, 1), 24);
        const rows = await CommunityStorage.listCommunityFeedPosts(pool, params.id_profile, {
          viewer_id_user: viewer?.id_user || null,
          limit: limit + 1, // +1 para saber se há próxima página
          before_ts,
          before_id,
        });
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const items = page.map((row) => PortfolioFeedService.shapeRow(row));
        let next_cursor = null;
        if (hasMore) {
          const last = page[page.length - 1];
          const ts = last.published_at instanceof Date ? last.published_at.toISOString() : last.published_at;
          next_cursor = Buffer.from(`${ts}|${last.post_id}`, "utf8").toString("base64");
        }
        return { items, next_cursor, has_more: hasMore };
      }
    );
  }

  // Liga um post/bee do membro ao feed da comunidade (chamado pelo composer).
  static async linkFeedItem(user, params, body) {
    return runWithLogs(
      log,
      "linkFeedItem",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const id_portfolio_item = body?.id_portfolio_item;
        if (!id_portfolio_item) return { error: "Post não informado." };

        // Precisa ser membro da comunidade.
        const membership = await CommunityStorage.getMembership(pool, params.id_profile, id_user);
        if (!membership) {
          return { error: "Você precisa ser membro para publicar na comunidade." };
        }
        // E o post tem que ser dele (anti-spoof).
        const owns = await CommunityStorage.itemBelongsToUser(pool, id_portfolio_item, id_user);
        if (!owns) return { error: "Este post não é seu." };

        const linked = await CommunityStorage.linkFeedItem(
          pool,
          params.id_profile,
          id_portfolio_item,
          id_user
        );
        return { ok: true, linked };
      }
    );
  }

  // Remove um post do feed da comunidade: o próprio autor OU o líder.
  static async unlinkFeedItem(user, params) {
    return runWithLogs(
      log,
      "unlinkFeedItem",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile, item: params?.id_portfolio_item }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
        const isLeader = String(community.id_leader_user) === String(id_user);
        const owns = await CommunityStorage.itemBelongsToUser(pool, params.id_portfolio_item, id_user);
        if (!isLeader && !owns) return { error: "Sem permissão para remover." };
        const ok = await CommunityStorage.unlinkFeedItem(pool, params.id_profile, params.id_portfolio_item);
        return { ok };
      }
    );
  }

  // ─── Benchmark (público) ──────────────────────────────────────────────────────
  static async getBenchmark(params) {
    return runWithLogs(
      log,
      "getBenchmark",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const benchmark = await CommunityStorage.getBenchmark(pool, params.id_profile);
        if (!benchmark) return { error: "Comunidade não encontrada", statusCode: 404 };
        const percentile =
          benchmark.total > 0
            ? Math.max(1, Math.round((benchmark.position / benchmark.total) * 100))
            : null;
        return { benchmark: { ...benchmark, percentile } };
      }
    );
  }

  // ─── Metas coletivas ─────────────────────────────────────────────────────────
  static async getGoal(params) {
    return runWithLogs(
      log,
      "getGoal",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const goal = await CommunityStorage.getActiveGoal(pool, params.id_profile);
        return { goal };
      }
    );
  }

  static async setGoal(user, params, body) {
    return runWithLogs(
      log,
      "setGoal",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const guard = await this._assertLeader(user?.id_user, params?.id_profile);
        if (guard.error) return guard;
        const title = String(body?.title || "").trim();
        if (!title) return { error: "Dê um nome para a meta." };
        if (title.length > 120) return { error: "O título deve ter no máximo 120 caracteres." };
        const metric = ["xp", "posts", "members"].includes(body?.metric) ? body.metric : "xp";
        const target = Number(body?.target_value);
        if (!Number.isFinite(target) || target <= 0) {
          return { error: "Defina um alvo válido (maior que zero)." };
        }
        const goal = await CommunityStorage.setGoal(pool, params.id_profile, {
          title,
          metric,
          target_value: target,
          ends_at: body?.ends_at || null,
          created_by_user: user.id_user,
        });
        return { goal };
      }
    );
  }

  static async clearGoal(user, params) {
    return runWithLogs(
      log,
      "clearGoal",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const guard = await this._assertLeader(user?.id_user, params?.id_profile);
        if (guard.error) return guard;
        return CommunityStorage.clearGoal(pool, params.id_profile);
      }
    );
  }

  // ─── Mural do líder ───────────────────────────────────────────────────────────
  // Mural é privado: só membros (líder incluso) leem os recados.
  static async listAnnouncements(params, viewer) {
    return runWithLogs(
      log,
      "listAnnouncements",
      () => ({ id_profile: params?.id_profile, viewer: viewer?.id_user ? "auth" : "anon" }),
      async () => {
        if (!viewer?.id_user) return { announcements: [] };
        const membership = await CommunityStorage.getMembership(pool, params.id_profile, viewer.id_user);
        if (!membership) return { announcements: [] };
        const announcements = await CommunityStorage.listAnnouncements(pool, params.id_profile);
        return { announcements };
      }
    );
  }

  static async createAnnouncement(user, params, body) {
    return runWithLogs(
      log,
      "createAnnouncement",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const guard = await this._assertLeader(user?.id_user, params?.id_profile);
        if (guard.error) return guard;
        const text = String(body?.body || "").trim();
        if (!text) return { error: "Escreva o recado." };
        if (text.length > 1000) return { error: "O recado deve ter no máximo 1000 caracteres." };
        const announcement = await CommunityStorage.createAnnouncement(pool, params.id_profile, {
          body: text,
          is_pinned: !!body?.is_pinned,
          created_by_user: user.id_user,
        });
        return { announcement };
      }
    );
  }

  static async deleteAnnouncement(user, params) {
    return runWithLogs(
      log,
      "deleteAnnouncement",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile, id: params?.id_announcement }),
      async () => {
        const guard = await this._assertLeader(user?.id_user, params?.id_profile);
        if (guard.error) return guard;
        const ok = await CommunityStorage.deleteAnnouncement(pool, params.id_profile, params.id_announcement);
        return { ok };
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
