// src/services/SubjectCommunityService.js
// Regras das modalidades cujo assunto é uma coisa (mig 210): pet, carro, games.
//
// As três criam o MESMO perfil-comunidade que a comunidade temática, o
// condomínio e o bairro criam — o que muda é o que faz o assunto existir:
//   • pet   → espécie + raça (ou vira-lata), uma por bicho;
//   • car   → marca + modelo, UM POR CARRO DO DONO (mig 259; era um por
//             modelo no site inteiro até então).
//
// ⚠️ GAMES SAIU DESTA LISTA NA MIG 232: ele deixou de ser o espaço de cada
// pessoa e virou PLATAFORMA do site inteiro, como o Financeiro. O que sobrou
// aqui dele é a porta de abrir (get-or-create do singleton) e o JOGO ATUAL,
// que é do USUÁRIO — a mesma divisão do Financeiro, onde o feed é da
// plataforma e a Carteira é de cada um.
//
// Nenhuma delas passa pelo gate de nível 5 nem pelos tetos de comunidade: são
// utilidade pessoal, como o condomínio e o bairro (mig 196/204). Cobrar
// ingresso para alguém criar a comunidade do próprio cachorro seria transformar
// o teto vendável de comunidade temática em pedágio de tudo.

const pool = require("../databases");
const CommunityStorage = require("../storages/CommunityStorage");
const SubjectCommunityStorage = require("../storages/SubjectCommunityStorage");
const PlatformStorage = require("../storages/PlatformStorage");
const PlatformAvatarService = require("./PlatformAvatarService");
const AcademyStorage = require("../storages/AcademyStorage");
const FeatureFlagService = require("./FeatureFlagService");
const fipe = require("../integrations/fipe/catalog");
const Subject = require("../utils/subjectCommunities");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("SubjectCommunityService");

class SubjectCommunityService {
  static async _assertEnabled(kind) {
    const flag = Subject.FEATURE_FLAG[kind];
    const enabled = await FeatureFlagService.isEnabled(flag);
    if (!enabled) {
      return { error: "Recurso indisponível no momento.", statusCode: 403 };
    }
    return null;
  }

  /**
   * Cria o perfil-comunidade e adiciona o dono como líder, dentro da transação
   * de quem chamou. `writeSubject` grava a linha da modalidade — e é a razão de
   * tudo estar numa transação só: comunidade de pet sem pet é um perfil órfão
   * que a página não sabe desenhar.
   */
  static async _createShell(client, { id_user, kind, display_name, bio, avatar_url }) {
    const community = await CommunityStorage.createCommunity(client, {
      id_user,
      // Sem enxame: "Golden Retriever" não é categoria profissional (mig 210 §2).
      id_machine: null,
      display_name,
      bio,
      avatar_url: avatar_url ?? null,
      theme: null,
      kind,
      address: null,
    });
    await CommunityStorage.addMember(client, community.id_profile, id_user, "leader");
    return community;
  }

  // ─── Pet ────────────────────────────────────────────────────────────────────
  static async listBreeds(query) {
    return runWithLogs(log, "listBreeds", () => ({ species: query?.species }), async () => {
      const species = Subject.PET_SPECIES.includes(query?.species) ? query.species : null;
      const breeds = await SubjectCommunityStorage.listBreeds(pool, species);
      return { breeds };
    });
  }

  static async createPet(user, payload) {
    return runWithLogs(
      log,
      "createPet",
      () => ({ id_user: user?.id_user, species: payload?.species }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const gate = await this._assertEnabled("pet");
        if (gate) return gate;

        // Nome é opcional: o menu da foto de perfil cria a comunidade ANTES de
        // perguntar qualquer coisa e abre a página já em modo de edição, onde o
        // dono batiza e escolhe a raça (decisão do Alex: "sem modal").
        const { display_name, bio } = Subject.normalizeCommon(payload);
        const name = display_name || Subject.PLACEHOLDER_NAME.pet;
        // A raça é resolvida ANTES da validação: é ela que decide se o bicho é
        // vira-lata, e essa decisão não pode vir do cliente.
        const breed = await SubjectCommunityStorage.getBreed(pool, {
          id_breed: payload?.id_breed ? Number(payload.id_breed) : null,
          species: payload?.species,
          slug: payload?.breed_slug,
        });
        const pet = Subject.validatePet(payload, breed);
        if (pet.error) return { error: pet.error, statusCode: 400 };

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const community = await this._createShell(client, {
            id_user,
            kind: "pet",
            display_name: name,
            bio,
            avatar_url: payload?.avatar_url,
          });
          const row = await SubjectCommunityStorage.createPet(
            client,
            community.id_profile,
            pet
          );
          await client.query("COMMIT");
          return { community, pet: row };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* conexão pode estar inutilizável */
          }
          log.error("createPet.fail", { id_user, error: err.message });
          return { error: "Não foi possível criar a comunidade do seu pet." };
        } finally {
          client.release();
        }
      }
    );
  }

  // ─── Games ──────────────────────────────────────────────────────────────────
  /**
   * ABRE A PLATAFORMA DE GAMES — não cria a de ninguém (mig 232).
   *
   * Antes, esta porta criava um espaço POR PESSOA. Agora ela devolve sempre a
   * MESMA linha, e quem garante isso é o banco (`ux_profile_games_singleton`):
   * duas primeiras aberturas simultâneas viram um insert e um conflito, e o
   * perdedor relê a linha do vencedor. Sem o índice, a plataforma nasceria
   * duplicada e os posts se dividiriam entre dois murais.
   *
   * ⚠️ A FLAG CONTINUA VALENDO na rota (`requireFeature("games")`): com o
   * ambiente desligado no Painel de Controle, ninguém abre a plataforma — nem
   * a cria sem querer.
   */
  static async openGamesPlatform(user) {
    return runWithLogs(
      log,
      "openGamesPlatform",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const gate = await this._assertEnabled("games");
        if (gate) return gate;
        const community = await PlatformStorage.getOrCreatePlatform(
          pool,
          PlatformStorage.GAMES_KIND
        );
        if (!community) return { error: "Não foi possível abrir a plataforma de games." };
        // A foto de quem está olhando DENTRO de games (mig 233), já resolvida:
        // a tela desenha o headcard com ela sem pagar uma segunda ida ao
        // servidor. Sem override, vem null e o front cai no rosto de sempre.
        const viewer_avatar = await PlatformAvatarService.resolve(
          user.id_user,
          PlatformStorage.GAMES_KIND,
          null
        );
        return { community, viewer_avatar };
      }
    );
  }

  /** O jogo atual de quem está pedindo. É DELE, não do espaço (mig 232). */
  static async getCurrentGame(user) {
    return runWithLogs(
      log,
      "getCurrentGame",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const subject = await SubjectCommunityStorage.getCurrentGame(pool, user.id_user);
        return { subject };
      }
    );
  }

  /**
   * Troca o jogo atual de quem está pedindo.
   *
   * ⚠️ NÃO HÁ GATE DE LÍDER AQUI, e não é esquecimento: o alvo da escrita é a
   * PRÓPRIA pessoa (a chave é o `id_user` do token), não um espaço de alguém.
   * É a mesma leitura da Carteira dentro do Financeiro — a plataforma é de
   * todos, o que está dentro dela é de cada um.
   */
  static async setCurrentGame(user, payload) {
    return runWithLogs(
      log,
      "setCurrentGame",
      () => ({ id_user: user?.id_user, platform: payload?.platform }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const gate = await this._assertEnabled("games");
        if (gate) return gate;
        const game = Subject.validateGame(payload);
        if (game.error) return { error: game.error, statusCode: 400 };
        const row = await SubjectCommunityStorage.upsertCurrentGame(
          pool,
          user.id_user,
          game
        );
        return { subject: { kind: "games", ...row } };
      }
    );
  }

  // ─── Carro ──────────────────────────────────────────────────────────────────
  static async listCarBrands() {
    return runWithLogs(log, "listCarBrands", () => ({}), async () => {
      const brands = await fipe.listBrands();
      // `available:false` é o que o front usa para oferecer o cadastro manual.
      // Lista vazia sem esse sinal pareceria "não existe marca nenhuma".
      return { brands, available: brands.length > 0 };
    });
  }

  static async listCarModels(params) {
    return runWithLogs(log, "listCarModels", () => ({ brand: params?.brand_code }), async () => {
      const models = await fipe.listModels(params?.brand_code);
      return { models, available: models.length > 0 };
    });
  }

  /**
   * Cria a comunidade de UM carro da pessoa (mig 259).
   *
   * Até a mig 259 esta porta era "achar-ou-criar": uma comunidade por modelo no
   * site inteiro, e o segundo dono de um Civic entrava na do primeiro. Agora é
   * como o pet — cada carro é uma comunidade do dono, quantas ele quiser — e o
   * que junta os donos do mesmo modelo é o FEED de carros, com o filtro "mesmo
   * carro que o meu" (`CommunityService.getFeedPosts`).
   *
   * Sem marca/modelo no corpo, nasce VAZIA e o modelo é escolhido no painel da
   * página (mig 211) — é o caminho do menu da foto de perfil.
   */
  static async createCar(user, payload) {
    return runWithLogs(
      log,
      "createCar",
      () => ({ id_user: user?.id_user, brand: payload?.brand_code, model: payload?.model_code }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const gate = await this._assertEnabled("car");
        if (gate) return gate;

        let model = null;
        if (payload?.brand_code || payload?.model_code) {
          const resolved = await this._resolveCarModel(payload);
          if (resolved.error) return resolved;
          model = resolved.model;
        }

        const { display_name, bio } = Subject.normalizeCommon(payload);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const community = await this._createShell(client, {
            id_user,
            kind: "car",
            display_name:
              display_name || (model ? Subject.carDisplayName(model) : Subject.PLACEHOLDER_NAME.car),
            bio,
            avatar_url: payload?.avatar_url,
          });
          let catalog = null;
          if (model) {
            catalog = await SubjectCommunityStorage.getOrCreateCarModel(client, model);
            await SubjectCommunityStorage.attachCarModel(
              client,
              community.id_profile,
              catalog.id_car_model
            );
          }
          await client.query("COMMIT");
          return { community: { ...community, ...(catalog || {}) }, created: true };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* noop */
          }
          log.error("createCar.fail", { id_user, error: err.message });
          return { error: "Não foi possível criar a comunidade do carro." };
        } finally {
          client.release();
        }
      }
    );
  }

  /**
   * Valida o par marca/modelo contra a FIPE. A FIPE manda nos rótulos quando
   * responde; quando não responde, o cadastro segue com o que veio do cliente
   * e a linha nasce 'manual' — travar o carro na disponibilidade de um
   * terceiro seria pior do que aceitar um rótulo eventualmente torto.
   */
  static async _resolveCarModel(payload) {
    const car = Subject.validateCar(payload);
    if (car.error) return { error: car.error, statusCode: 400 };
    const check = await fipe.verifyModel(car);
    if (check.verified === false) {
      return { error: "Modelo não encontrado na tabela FIPE.", statusCode: 400 };
    }
    return {
      model: {
        ...car,
        brand_label: check.brand_label || car.brand_label,
        model_label: check.model_label || car.model_label,
        source: check.verified ? "fipe" : "manual",
      },
    };
  }

  // ─── Edição do assunto (dentro da página, sem modal) ────────────────────────
  /**
   * Troca o assunto de uma comunidade de pet/carro. Só o líder.
   *
   * ⚠️ GAMES NÃO PASSA MAIS POR AQUI (mig 232): o jogo atual é da PESSOA, e
   * quem o grava é `setCurrentGame`, sem gate de líder — porque o alvo da
   * escrita é quem está pedindo, e não o espaço de alguém.
   *
   * Desde a mig 259 o modelo do carro NÃO é mais único no site: dois donos de
   * Civic têm cada um a comunidade do seu, então escolher o modelo nunca
   * colide com ninguém.
   */
  static async updateSubject(user, params, payload) {
    return runWithLogs(
      log,
      "updateSubject",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile, kind: params?.kind }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };

        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
        if (community.kind !== params.kind) {
          return { error: "Esta comunidade não é dessa modalidade.", statusCode: 400 };
        }
        if (String(community.id_leader_user) !== String(id_user)) {
          return { error: "Só o líder pode editar.", statusCode: 403 };
        }

        if (params.kind === "pet") {
          const breed = await SubjectCommunityStorage.getBreed(pool, {
            id_breed: payload?.id_breed ? Number(payload.id_breed) : null,
            species: payload?.species,
            slug: payload?.breed_slug,
          });
          const pet = Subject.validatePet(payload, breed);
          if (pet.error) return { error: pet.error, statusCode: 400 };
          const row = await SubjectCommunityStorage.upsertPet(pool, params.id_profile, pet);
          return { subject: { kind: "pet", ...row } };
        }


        // Carro
        const resolved = await this._resolveCarModel(payload);
        if (resolved.error) return resolved;
        const model = resolved.model;
        const catalog = await SubjectCommunityStorage.getOrCreateCarModel(pool, model);
        await SubjectCommunityStorage.attachCarModel(pool, params.id_profile, catalog.id_car_model);

        await SubjectCommunityStorage.renameIfPlaceholder(
          pool,
          params.id_profile,
          Subject.PLACEHOLDER_NAME.car,
          Subject.carDisplayName(model)
        );
        return { subject: { kind: "car", ...catalog } };
      }
    );
  }

  // ─── Os espaços que o visitante vê na foto de outra pessoa ─────────────────
  /**
   * Porta ANÔNIMA: devolve só o id e o nome de cada espaço (o que o pill
   * precisa para existir e navegar). Quem decide o que o visitante enxerga lá
   * dentro continua sendo a página da comunidade (privada tranca o feed).
   */
  static async publicSpaces(handle) {
    return runWithLogs(log, "publicSpaces", () => ({ handle }), async () => {
      const username = String(handle || "").trim().replace(/^@/, "");
      if (!username || username.length > 40) return { error: "Usuário inválido" };
      const rows = await SubjectCommunityStorage.listLeaderSpacesByUsername(pool, username);
      const out = { business: null, pet: null, car: null };
      for (const r of rows) {
        const key = r.kind === "common" ? "business" : r.kind;
        out[key] = { id_profile: r.id_profile, display_name: r.display_name };
      }
      return { spaces: out };
    });
  }

  // ─── Meus espaços (o menu da foto de perfil) ────────────────────────────────
  /**
   * Tudo o que o menu precisa numa requisição só: as comunidades da pessoa
   * agrupadas por modalidade + as academias (que são entidade própria, mig 176).
   */
  static async mySpaces(user) {
    return runWithLogs(log, "mySpaces", () => ({ id_user: user?.id_user }), async () => {
      const id_user = user?.id_user;
      if (!id_user) return { error: "Usuário não autenticado" };

      const rows = await SubjectCommunityStorage.listMySpaces(pool, id_user);
      const spaces = { common: [], condo: [], neighborhood: [], pet: [], car: [], games: [] };
      for (const row of rows) {
        const bucket = spaces[row.kind];
        if (bucket) bucket.push(row);
      }

      // Academia entra pelos dois lados: a que a pessoa é dona e a que ela
      // frequenta. Para o menu as duas são "minha academia" — quem quiser saber
      // a diferença olha o papel.
      const academies = [];
      const seen = new Set();
      const [owned, memberships] = await Promise.all([
        AcademyStorage.listByOwner(pool, id_user),
        AcademyStorage.listMembershipsByUser(pool, id_user),
      ]);
      for (const a of owned) {
        seen.add(a.id_academy);
        academies.push({
          id_academy: a.id_academy,
          slug: a.slug,
          display_name: a.nome,
          avatar_url: a.avatar_url || null,
          role: "owner",
        });
      }
      for (const m of memberships) {
        if (seen.has(m.id_academy)) continue;
        seen.add(m.id_academy);
        academies.push({
          id_academy: m.id_academy,
          slug: m.academy_slug,
          display_name: m.academy_nome,
          avatar_url: m.academy_avatar_url || null,
          role: "member",
        });
      }

      return { spaces, academies };
    });
  }
}

module.exports = SubjectCommunityService;
