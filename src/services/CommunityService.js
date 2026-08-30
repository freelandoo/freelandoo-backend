// src/services/CommunityService.js
// Regras da Comunidade: criação (gate nível 5 + tetos), leitura, tema e
// entrada/saída de membros (Slice 2). Substitui o ClanService no novo conceito.

const pool = require("../databases");
const CommunityStorage = require("../storages/CommunityStorage");
const PortfolioFeedService = require("./portfolioFeed/PortfolioFeedService");
const PolenStorage = require("../storages/PolenStorage");
const FeatureFlagService = require("./FeatureFlagService");
const CondoRules = require("../utils/condoRules");
const CondoStorage = require("../storages/CondoStorage");
const StoryStorage = require("../storages/StoryStorage");
const NeighborhoodStorage = require("../storages/NeighborhoodStorage");
const CommunityPolicy = require("../utils/communityPolicy");
const { createLogger, runWithLogs } = require("../utils/logger");
const { normalizeFeedKind } = require("../utils/feedKind");

const log = createLogger("CommunityService");

const REQUIRED_LEVEL_TO_CREATE = 5;
const COMMUNITY_KINDS = CondoRules.COMMUNITY_KINDS;

// Temporada (meta): prêmio bancado pela plataforma, mínimos anti-abuso.
const GOAL_PRIZE_POLENS = 100;
const GOAL_MIN_DAYS = 30;
const GOAL_MIN_MEMBERS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

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

        const { display_name, id_machine, bio, avatar_url, theme, address } =
          payload || {};
        if (!display_name || !String(display_name).trim()) {
          return { error: "O nome da comunidade é obrigatório." };
        }
        if (!id_machine) return { error: "O enxame é obrigatório." };
        const bioStr = bio ? String(bio).trim() : null;
        if (bioStr && bioStr.length > 200) {
          return { error: "A bio deve ter no máximo 200 caracteres." };
        }

        // Modalidade (mig 196). 'academy' fica reservado: academia é a feature
        // própria (/academias, mig 176) — o seletor do front manda pra lá em
        // vez de criar uma comunidade vazia com esse rótulo.
        const kind = COMMUNITY_KINDS.includes(payload?.kind)
          ? payload.kind
          : "common";
        if (kind === "academy") {
          return {
            error:
              "Academia tem cadastro próprio: crie pela página de Academias.",
            statusCode: 400,
          };
        }
        if (kind === "condo") {
          const enabled = await FeatureFlagService.isEnabled("condominio");
          if (!enabled) {
            return { error: "Recurso indisponível no momento.", statusCode: 403 };
          }
          const addrErr = CondoRules.validateAddress(address);
          if (addrErr) return { error: addrErr, statusCode: 400 };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          // Condomínio não passa pelo gate de nível nem pelos tetos: não é
          // comunidade de enxame (não pontua XP nem ranking) — é utilidade do
          // prédio. Quem mora não pode ficar sem por já participar de outra.
          if (kind !== "condo") {
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
          }

          // 3. Cria perfil-comunidade (líder) + adiciona o user como líder
          const community = await CommunityStorage.createCommunity(client, {
            id_user,
            id_machine,
            display_name: String(display_name).trim(),
            bio: bioStr,
            avatar_url: avatar_url ?? null,
            theme: theme ?? null,
            kind,
            address: kind === "condo" ? CondoRules.normalizeAddress(address) : null,
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
  // viewer (opcional) resolve membership/assinatura — a página precisa saber se
  // mostra o feed ou a trava de comunidade privada.
  static async getById(params, viewer) {
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

        let membership = null;
        let viewer_sub_status = null;
        if (viewer?.id_user) {
          membership = await CommunityStorage.getMembership(pool, params.id_profile, viewer.id_user);
          const sub = await CommunityStorage.getLiveMemberSub(pool, params.id_profile, viewer.id_user);
          viewer_sub_status = sub ? sub.status : null;
        }
        const viewer_membership = membership ? membership.role : null;
        const isAdmin = viewer_membership === "leader" || viewer_membership === "vice";

        // Os campos viewer_* são acrescentados DEPOIS da projeção de propósito:
        // eles descrevem o próprio viewer, não a comunidade — não são dado
        // alheio e não podem ser recortados.

        // Condomínio: endereço de rua e situação de moradia só para quem tem
        // direito. Visitante enxerga bairro/cidade/UF (é assim que ele acha o
        // prédio na busca) e nada mais.
        if (community.kind === "condo") {
          const resident = await this._resolveResident(community, viewer);
          const tier = CommunityPolicy.resolveTier({
            viewer,
            membership,
            isResident: !!resident?.confirmed,
          });
          const canSeeAddress = isAdmin || !!resident?.confirmed;
          const base = CondoRules.stripAddressColumns(community);
          return {
            community: {
              ...CommunityPolicy.projectCommunity(base, tier),
              address: canSeeAddress
                ? CondoRules.fullAddress(community)
                : CondoRules.publicAddress(community),
              address_is_full: canSeeAddress,
              viewer_is_member: !!viewer_membership,
              viewer_role: viewer_membership,
              viewer_sub_status,
              viewer_is_admin: isAdmin,
              viewer_is_resident: !!resident?.confirmed,
              viewer_has_pending_claim: !!resident?.pending,
              viewer_units: resident?.units || [],
              viewer_parking: resident?.parking || [],
            },
          };
        }

        // Bairro: o visitante vê bairro/cidade/UF (é como ele acha o lugar onde
        // acabou de se mudar) e a POSIÇÃO DELE — se já declarou residência e se
        // os vizinhos já reconheceram. Sem isso a tela não sabe se mostra
        // "entrar", "aguardando reconhecimento" ou "declarar residência".
        const resident = await this._resolveResident(community, viewer);
        const tier = CommunityPolicy.resolveTier({
          viewer,
          membership,
          isResident: !!resident.confirmed,
        });
        return {
          community: {
            ...CommunityPolicy.projectCommunity(community, tier),
            viewer_is_member: !!viewer_membership,
            viewer_role: viewer_membership,
            viewer_sub_status,
            ...(community.kind === "neighborhood"
              ? {
                  viewer_is_resident: !!resident.confirmed,
                  viewer_residence_status: resident.status || null,
                }
              : {}),
          },
        };
      }
    );
  }

  // ─── Privacidade (comunidade privada com mensalidade) ────────────────────────
  static async updatePrivacy(user, params, body) {
    return runWithLogs(
      log,
      "updatePrivacy",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile, privacy: body?.privacy }),
      async () => {
        const guard = await this._assertLeader(user?.id_user, params?.id_profile);
        if (guard.error) return guard;

        const privacy = body?.privacy === "private" ? "private" : body?.privacy === "public" ? "public" : null;
        if (!privacy) return { error: "Privacidade inválida (public|private).", statusCode: 400 };

        if (privacy === "private") {
          const settings = await CommunityStorage.getSettings(pool);
          const monthly = Math.round(Number(body?.monthly_cents));
          if (!Number.isFinite(monthly) || monthly < Number(settings.min_monthly_cents)) {
            return {
              error: `A mensalidade mínima é R$ ${(Number(settings.min_monthly_cents) / 100).toFixed(2)}.`,
              statusCode: 400,
              min_monthly_cents: Number(settings.min_monthly_cents),
            };
          }
          const updated = await CommunityStorage.setPrivacy(pool, params.id_profile, {
            privacy: "private",
            monthly_cents: monthly,
          });
          return { ok: true, ...updated };
        }

        // private → public: membros atuais ficam (viraram gratuitos); as
        // assinaturas param de cobrar no fim do ciclo já pago.
        const updated = await CommunityStorage.setPrivacy(pool, params.id_profile, {
          privacy: "public",
          monthly_cents: null,
        });
        const CommunityMembershipService = require("./CommunityMembershipService");
        CommunityMembershipService.releaseAllSubscriptions(params.id_profile).catch((err) =>
          log.error("updatePrivacy.release_fail", { id_profile: params.id_profile, error: err.message })
        );
        return { ok: true, ...updated };
      }
    );
  }

  // Feed/mural interno: quem lê é decidido pela política da modalidade.
  // Temática pública é aberta; privada exige membro; territorial (condomínio,
  // e bairro quando chegar) é interna SEMPRE, com ou sem mensalidade.
  static async _assertCanViewPrivateContent(id_community, viewer) {
    const community = await CommunityStorage.getById(pool, id_community);
    if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
    if (!CommunityPolicy.policyFor(community).feedRequiresMembership) return { community };
    if (!viewer?.id_user) return { locked: true, community };
    const membership = await CommunityStorage.getMembership(pool, id_community, viewer.id_user);
    if (!membership) return { locked: true, community };
    return { community };
  }

  // A listagem é pública, mas o RECORTE depende do viewer: contadores de
  // comunidade privada e de condomínio só saem para quem já é de dentro.
  // Uma consulta só resolve o vínculo do viewer com TODAS as comunidades dele
  // (listForUser) — não há N+1 aqui.
  static async listPublic(query, viewer) {
    return runWithLogs(
      log,
      "listPublic",
      () => ({ q: query?.q, viewer: viewer?.id_user ? "auth" : "anon" }),
      async () => {
        const communities = await CommunityStorage.listPublic(pool, {
          q: query?.q,
          id_machine: query?.id_machine,
          id_region: query?.id_region,
          kind: COMMUNITY_KINDS.includes(query?.kind) ? query.kind : null,
          limit: query?.limit,
          offset: query?.offset,
        });

        const roleByCommunity = new Map();
        if (viewer?.id_user) {
          const mine = await CommunityStorage.listForUser(pool, viewer.id_user);
          for (const row of mine) {
            roleByCommunity.set(String(row.id_profile), row.role);
          }
        }

        // Morador não é resolvido aqui: na listagem o único recurso em jogo é
        // `counters`, cujo mínimo é `member` — resolver residência por linha
        // custaria duas queries por card sem mudar nenhuma decisão.
        const projected = communities.map((row) => {
          const role = roleByCommunity.get(String(row.id_profile)) || null;
          const tier = CommunityPolicy.resolveTier({
            viewer,
            membership: role ? { role } : null,
          });
          return CommunityPolicy.projectCommunity(row, tier);
        });

        return { communities: projected };
      }
    );
  }

  // Saber QUEM está dentro é o dado mais sensível da comunidade. O tier mínimo
  // vem da política: temática pública libera; temática privada exige membro;
  // territorial exige morador confirmado (ou a administração).
  static async getMembers(params, viewer) {
    return runWithLogs(
      log,
      "getMembers",
      () => ({ id_profile: params?.id_profile, viewer: viewer?.id_user ? "auth" : "anon" }),
      async () => {
        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };

        const membership = viewer?.id_user
          ? await CommunityStorage.getMembership(pool, params.id_profile, viewer.id_user)
          : null;
        const isAdmin = membership?.role === "leader" || membership?.role === "vice";

        const resident = await this._resolveResident(community, viewer);

        const policy = CommunityPolicy.policyFor(community);
        const tier = CommunityPolicy.resolveTier({
          viewer,
          membership,
          isResident: !!resident?.confirmed,
        });

        if (!CommunityPolicy.can(policy, "memberList", tier)) {
          return {
            error:
              community.kind === "condo"
                ? "Somente moradores do condomínio veem esta lista."
                : "Somente membros da comunidade veem esta lista.",
            statusCode: 403,
          };
        }

        if (community.kind === "condo") {
          // Morador vê os vizinhos; a unidade de cada um só aparece para o
          // administrador (o morador comum vê nome, não onde a pessoa mora).
          const members = await CondoStorage.listResidents(pool, params.id_profile, {
            with_units: isAdmin,
          });
          return { members };
        }

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

  static async getFeed(params, query, viewer) {
    return runWithLogs(
      log,
      "getFeed",
      () => ({ id_profile: params?.id_profile, kind: query?.kind }),
      async () => {
        const gate = await this._assertCanViewPrivateContent(params.id_profile, viewer);
        if (gate.error) return gate;
        if (gate.locked) return { items: [], locked: true };
        const kindRaw = query?.kind;
        const kind = normalizeFeedKind(kindRaw);
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

  // ─── Feed estilo grupo (posts dos membros + recados só-texto) ───────────────
  // Feed unificado (posts + bees + recados), cronológico, no shape FeedPost do
  // /feed. Posts e recados saem de fontes distintas e são mesclados em JS por uma
  // chave de ordenação comum (ts, key textual): post → uuid; recado → 'r<id>'.
  static _isoTs(ts) {
    return ts instanceof Date ? ts.toISOString() : String(ts);
  }

  static async getFeedPosts(params, query, viewer) {
    return runWithLogs(
      log,
      "getFeedPosts",
      () => ({ id_profile: params?.id_profile, cursor: query?.cursor || null }),
      async () => {
        const gate = await this._assertCanViewPrivateContent(params.id_profile, viewer);
        if (gate.error) return gate;
        if (gate.locked) return { items: [], next_cursor: null, has_more: false, locked: true };
        let before_ts = null;
        let before_key = null;
        if (query?.cursor) {
          try {
            const decoded = Buffer.from(String(query.cursor), "base64").toString("utf8");
            const sep = decoded.lastIndexOf("|");
            if (sep > 0) {
              before_ts = decoded.slice(0, sep);
              before_key = decoded.slice(sep + 1);
            }
          } catch {
            /* cursor inválido — começa do início */
          }
        }
        const limit = Math.min(Math.max(Number(query?.limit) || 12, 1), 24);

        // +1 em cada fonte garante que o top-`limit` da mescla está completo.
        const [postRows, recadoRows] = await Promise.all([
          CommunityStorage.listCommunityFeedPosts(pool, params.id_profile, {
            viewer_id_user: viewer?.id_user || null,
            limit: limit + 1,
            before_ts,
            before_key,
          }),
          CommunityStorage.listCommunityRecados(pool, params.id_profile, {
            limit: limit + 1,
            before_ts,
            before_key,
          }),
        ]);

        const shape = (row, isRecado) => {
          const item = PortfolioFeedService.shapeRow(row);
          if (isRecado) {
            item.is_recado = true;
            item.recado_id = Number(row.recado_id);
            item.author_user_id = row.id_author_user || null;
          }
          return {
            item,
            _ts: new Date(this._isoTs(row.published_at)).getTime() || 0,
            _iso: this._isoTs(row.published_at),
            _key: String(row.post_id),
          };
        };

        const merged = [
          ...postRows.map((r) => shape(r, false)),
          ...recadoRows.map((r) => shape(r, true)),
        ].sort((a, b) => {
          if (a._ts !== b._ts) return b._ts - a._ts;
          return a._key < b._key ? 1 : a._key > b._key ? -1 : 0;
        });

        const hasMore = merged.length > limit;
        const page = hasMore ? merged.slice(0, limit) : merged;
        const items = page.map((x) => x.item);
        let next_cursor = null;
        if (hasMore && page.length) {
          const last = page[page.length - 1];
          next_cursor = Buffer.from(`${last._iso}|${last._key}`, "utf8").toString("base64");
        }
        return { items, next_cursor, has_more: hasMore };
      }
    );
  }

  // Cria um recado (nota só-texto) no feed da comunidade. Só membros publicam.
  /**
   * Resolve "esta pessoa é MORADORA desta comunidade?" para qualquer
   * modalidade. Um lugar só: o predicado do §4.2 é o mesmo nas duas, muda o
   * ESCOPO — condomínio resolve pelo endereço, bairro pelo território.
   *
   * Existe para que `kind === 'condo'` não continue espalhado pelos guards.
   * Era assim que os vazamentos nasciam: alguém escrevia um guard novo e
   * esquecia metade das modalidades. Modalidade não-territorial devolve
   * `confirmed: false` sem tocar o banco — lá "morador" não quer dizer nada.
   */
  static async _resolveResident(community, viewer) {
    if (!viewer?.id_user || !community) return { confirmed: false };
    if (community.kind === "condo") {
      return (
        (await CondoStorage.getResidentStatus(
          pool,
          community.id_profile,
          viewer.id_user
        )) || { confirmed: false }
      );
    }
    if (community.kind === "neighborhood") {
      if (!community.id_territory) return { confirmed: false };
      const status = await NeighborhoodStorage.getResidentStatus(pool, {
        id_territory: community.id_territory,
        id_user: viewer.id_user,
      });
      return { confirmed: status.recognized, status: status.status };
    }
    return { confirmed: false };
  }

  static async createRecado(user, params, body) {
    return runWithLogs(
      log,
      "createRecado",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const text = String(body?.body || "").trim();
        if (!text) return { error: "Escreva o recado." };
        if (text.length > 2000) {
          return { error: "O recado deve ter no máximo 2000 caracteres." };
        }
        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
        const membership = await CommunityStorage.getMembership(pool, params.id_profile, id_user);
        if (!membership) {
          return { error: "Você precisa ser membro para publicar na comunidade." };
        }
        const id = await CommunityStorage.createRecado(pool, params.id_profile, {
          body: text,
          id_author_user: id_user,
        });
        return { ok: true, id };
      }
    );
  }

  // Remove um recado: o próprio autor OU o líder da comunidade.
  static async deleteRecado(user, params) {
    return runWithLogs(
      log,
      "deleteRecado",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile, id: params?.id_feed_item }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
        const item = await CommunityStorage.getFeedItem(pool, params.id_feed_item);
        if (!item || item.kind !== "recado" || String(item.id_community_profile) !== String(params.id_profile)) {
          return { error: "Recado não encontrado", statusCode: 404 };
        }
        const isLeader = String(community.id_leader_user) === String(id_user);
        const isAuthor = String(item.id_author_user) === String(id_user);
        if (!isLeader && !isAuthor) return { error: "Sem permissão para remover." };
        const ok = await CommunityStorage.deleteRecado(pool, params.id_profile, params.id_feed_item);
        return { ok };
      }
    );
  }

  // Registra o retorno de um link de share (público; chamado pela rota /cs).
  static async logShareReturn(params, body) {
    return runWithLogs(
      log,
      "logShareReturn",
      () => ({ id_profile: params?.id_profile, member: body?.id_member_user }),
      async () => {
        const id_member_user = body?.id_member_user;
        const id_portfolio_item = body?.id_portfolio_item;
        const visitor_hash = body?.visitor_hash;
        if (!id_member_user || !id_portfolio_item || !visitor_hash) {
          return { ok: false };
        }
        const counted = await CommunityStorage.logShareReturn(pool, {
          id_community: params.id_profile,
          id_member_user,
          id_portfolio_item,
          visitor_hash,
        });
        return { ok: true, counted };
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

        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };

        // Post exclusivo de OUTRA comunidade privada não pode ser republicado.
        const exclusiveOf = await CommunityStorage.getItemExclusiveCommunity(pool, id_portfolio_item);
        if (exclusiveOf && String(exclusiveOf) !== String(params.id_profile)) {
          return { error: "Este post é exclusivo de outra comunidade privada." };
        }

        // Comunidade privada: o post vira EXCLUSIVO dela (some do /feed, bees e
        // perfil público — "fica só lá dentro"). Só se não estiver ligado a
        // nenhuma outra comunidade.
        // CONDOMÍNIO é sempre exclusivo, pago ou não: o que se posta no mural
        // do prédio não pode vazar pro feed global nem pro perfil público do
        // morador (mig 196).
        const isExclusive = CommunityPolicy.policyFor(community).contentIsExclusive;
        if (isExclusive) {
          const elsewhere = await CommunityStorage.itemLinkedElsewhere(pool, id_portfolio_item, params.id_profile);
          if (elsewhere) {
            return { error: "Este post já está publicado em outra comunidade e não pode virar exclusivo." };
          }
        }

        const linked = await CommunityStorage.linkFeedItem(
          pool,
          params.id_profile,
          id_portfolio_item,
          id_user
        );
        if (isExclusive) {
          await CommunityStorage.setItemExclusiveCommunity(pool, id_portfolio_item, params.id_profile);
        }
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
        // Se o post era exclusivo DESTA comunidade, volta a ser público.
        const exclusiveOf = await CommunityStorage.getItemExclusiveCommunity(pool, params.id_portfolio_item);
        if (exclusiveOf && String(exclusiveOf) === String(params.id_profile)) {
          await CommunityStorage.setItemExclusiveCommunity(pool, params.id_portfolio_item, null);
        }
        return { ok };
      }
    );
  }

  // Guard de leitura por política. Devolve { community } quando liberado, ou
  // { error, statusCode } quando não. Usado por /goal e /benchmark, que até o
  // desenho macro respondiam sem nenhuma autenticação (C2).
  static async _assertCanRead(id_community, viewer, resource) {
    const community = await CommunityStorage.getById(pool, id_community);
    if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };

    const membership = viewer?.id_user
      ? await CommunityStorage.getMembership(pool, id_community, viewer.id_user)
      : null;
    const resident = await this._resolveResident(community, viewer);

    const policy = CommunityPolicy.policyFor(community);
    const tier = CommunityPolicy.resolveTier({
      viewer,
      membership,
      isResident: !!resident?.confirmed,
    });
    if (!CommunityPolicy.can(policy, resource, tier)) {
      return { error: "Conteúdo restrito aos membros desta comunidade.", statusCode: 403 };
    }
    return { community };
  }

  // ─── Benchmark ────────────────────────────────────────────────────────────────
  static async getBenchmark(params, viewer) {
    return runWithLogs(
      log,
      "getBenchmark",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const gate = await this._assertCanRead(params.id_profile, viewer, "benchmark");
        if (gate.error) return gate;

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
  // Monta o objeto da temporada (campos + ranking + progresso agregado).
  static _assembleGoal(goal, ranking) {
    const totalScore = ranking.reduce((s, r) => s + (Number(r.score) || 0), 0);
    const target = goal.target_value != null ? Number(goal.target_value) : null;
    const winner = goal.winner_user_id
      ? ranking.find((r) => String(r.id_user) === String(goal.winner_user_id)) || null
      : null;
    return {
      id: goal.id,
      title: goal.title,
      metric: goal.metric,
      target_value: target,
      prize_polens: Number(goal.prize_polens) || 0,
      status: goal.status,
      starts_at: goal.starts_at,
      ends_at: goal.ends_at,
      closed_at: goal.closed_at,
      progress: totalScore,
      percent: target && target > 0 ? Math.min(100, Math.round((totalScore / target) * 100)) : null,
      winner_user_id: goal.winner_user_id || null,
      winner: winner
        ? { id_user: winner.id_user, name: winner.display_name || winner.user_name, avatar_url: winner.avatar_url, score: winner.score }
        : null,
      ranking: ranking.slice(0, 20).map((r) => ({
        id_user: r.id_user,
        name: r.display_name || r.user_name,
        username: r.username || null,
        avatar_url: r.avatar_url || null,
        xp_level: r.xp_level ?? null,
        score: Number(r.score) || 0,
        posts: r.posts != null ? Number(r.posts) : undefined,
        eng: r.eng != null ? Number(r.eng) : undefined,
      })),
    };
  }

  // Encerra a temporada vencida e credita o prêmio ao #1 (idempotente).
  static async _closeAndPay(goal, ranking) {
    const top = ranking[0];
    const winnerUserId = top && top.score > 0 ? top.id_user : null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const closed = await CommunityStorage.closeGoal(client, goal.id, winnerUserId);
      if (closed && winnerUserId && Number(goal.prize_polens) > 0) {
        const wallet = await PolenStorage.getOrCreateWallet(client, winnerUserId);
        await PolenStorage.credit(client, {
          user_id: winnerUserId,
          wallet_id: wallet.id,
          amount: Number(goal.prize_polens),
          type: "earn_community_goal",
          source: "community_goal",
          source_id: String(goal.id),
          metadata: { id_goal: goal.id, id_community: goal.id_community_profile, metric: goal.metric },
        });
        await CommunityStorage.markPrizePaid(client, goal.id);
      }
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* noop */ }
      log.error("closeAndPay.fail", { id_goal: goal.id, error: err.message });
    } finally {
      client.release();
    }
  }

  static async getGoal(params, viewer) {
    return runWithLogs(
      log,
      "getGoal",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const gate = await this._assertCanRead(params.id_profile, viewer, "goal");
        if (gate.error) return gate;

        const goal = await CommunityStorage.getActiveGoalRow(pool, params.id_profile);
        if (!goal) return { goal: null };

        const now = Date.now();
        const endsTs = goal.ends_at ? new Date(goal.ends_at).getTime() : null;
        const due = goal.status === "active" && endsTs && endsTs < now;
        // Mede até agora (temporada viva) ou até o fim (encerrada).
        const asOf = endsTs && endsTs < now ? goal.ends_at : new Date().toISOString();
        const ranking = await CommunityStorage.getGoalRanking(pool, goal, asOf);

        if (due) {
          await this._closeAndPay(goal, ranking);
          const refreshed = await CommunityStorage.getActiveGoalRow(pool, params.id_profile);
          return { goal: this._assembleGoal(refreshed || goal, ranking) };
        }
        return { goal: this._assembleGoal(goal, ranking) };
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
        if (!title) return { error: "Dê um nome para a temporada." };
        if (title.length > 120) return { error: "O título deve ter no máximo 120 caracteres." };

        const metric = CommunityStorage.GOAL_METRICS.includes(body?.metric) ? body.metric : "xp";

        // Prazo obrigatório, mínimo 30 dias.
        const endsTs = body?.ends_at ? new Date(body.ends_at).getTime() : NaN;
        if (!Number.isFinite(endsTs)) return { error: "Defina o prazo da temporada." };
        if (endsTs < Date.now() + GOAL_MIN_DAYS * DAY_MS) {
          return { error: `O prazo deve ser de pelo menos ${GOAL_MIN_DAYS} dias.`, min_days: GOAL_MIN_DAYS };
        }

        // Gate anti-abuso: comunidade precisa de >= 5 membros pra valer prêmio.
        const community = guard.community;
        const memberCount = Number(community?.member_count) || 0;
        if (memberCount < GOAL_MIN_MEMBERS) {
          return { error: `A comunidade precisa de pelo menos ${GOAL_MIN_MEMBERS} membros para ativar uma temporada.`, min_members: GOAL_MIN_MEMBERS, member_count: memberCount };
        }

        // Alvo é opcional (só a barra agregada); a temporada vale pelo ranking.
        let target = null;
        if (body?.target_value != null && body.target_value !== "") {
          const tv = Number(body.target_value);
          if (Number.isFinite(tv) && tv > 0) target = tv;
        }

        await CommunityStorage.setGoal(pool, params.id_profile, {
          title,
          metric,
          target_value: target,
          ends_at: new Date(endsTs).toISOString(),
          prize_polens: GOAL_PRIZE_POLENS,
          created_by_user: user.id_user,
        });
        return this.getGoal(params);
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
  /**
   * A faixa de bees do mural (mig 208). Bee é conteúdo INTERNO da comunidade:
   * a mesma trava do feed vale aqui — comunidade privada e condomínio não
   * mostram nada para quem está de fora. E no condomínio "de dentro" quer dizer
   * MORADOR, não membro.
   */
  static async listBees(user, params) {
    return runWithLogs(
      log,
      "listBees",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado", statusCode: 401 };

        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };

        const membership = await CommunityStorage.getMembership(
          pool,
          params.id_profile,
          id_user
        );
        const isAdmin = membership?.role === "leader" || membership?.role === "vice";

        if (community.kind === "condo") {
          const resident = await CondoStorage.getResidentStatus(
            pool,
            params.id_profile,
            id_user
          );
          if (!resident.confirmed && !isAdmin) {
            return { bees: [], locked: true };
          }
        } else if (community.privacy === "private" && !membership) {
          return { bees: [], locked: true };
        }

        const bees = await StoryStorage.listActiveByCommunity(pool, {
          id_community: params.id_profile,
        });
        return { bees };
      }
    );
  }

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

          // Comunidade privada: a entrada é paga (assinatura mensal). O front
          // recebe requires_payment e chama /membership/checkout.
          if (community.privacy === "private" && Number(community.monthly_cents) > 0) {
            await client.query("ROLLBACK");
            return {
              ok: false,
              requires_payment: true,
              monthly_cents: Number(community.monthly_cents),
            };
          }

          // Condomínio NÃO tem visitante (decisão do Alex, 2026-08-29). Entrar
          // no prédio é dizer onde você mora: a entrada acontece em
          // `CondoResidenceService.claimUnit`, que escolhe o apartamento na
          // planta e cria a associação junto com o vínculo de morador.
          //
          // Recusar aqui é o que dá sentido ao resto: enquanto este caminho
          // existisse, qualquer pessoa entraria pelo botão genérico de
          // "Entrar" e apareceria na lista de membros do condomínio sem nunca
          // ter dito em que apartamento mora.
          if (community.kind === "condo") {
            await client.query("ROLLBACK");
            return {
              error:
                "Para entrar no condomínio, escolha seu apartamento na planta.",
              statusCode: 409,
              needs_claim: true,
            };
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
        // Membro pagante saindo → cancela a assinatura Stripe (imediato).
        const CommunityMembershipService = require("./CommunityMembershipService");
        await CommunityMembershipService.cancelForUser(params.id_profile, id_user);
        await CommunityStorage.removeMember(pool, params.id_profile, id_user);
        return { ok: true };
      }
    );
  }
}

module.exports = CommunityService;
