// src/services/SubjectCommunityService.js
// Regras das modalidades cujo assunto é uma coisa (mig 210): pet, carro, games.
//
// As três criam o MESMO perfil-comunidade que a comunidade temática, o
// condomínio e o bairro criam — o que muda é o que faz o assunto existir:
//   • pet   → espécie + raça (ou vira-lata), uma por bicho;
//   • games → plataforma + jogo, uma por jogo da pessoa;
//   • car   → marca + modelo, UMA no site inteiro (o primeiro funda, o resto
//             entra).
//
// Nenhuma delas passa pelo gate de nível 5 nem pelos tetos de comunidade: são
// utilidade pessoal, como o condomínio e o bairro (mig 196/204). Cobrar
// ingresso para alguém criar a comunidade do próprio cachorro seria transformar
// o teto vendável de comunidade temática em pedágio de tudo.

const pool = require("../databases");
const CommunityStorage = require("../storages/CommunityStorage");
const SubjectCommunityStorage = require("../storages/SubjectCommunityStorage");
const AcademyStorage = require("../storages/AcademyStorage");
const FeatureFlagService = require("./FeatureFlagService");
const fipe = require("../integrations/fipe/catalog");
const Subject = require("../utils/subjectCommunities");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("SubjectCommunityService");

// Violação do índice `ux_profile_car_model`: dois fundadores no mesmo segundo.
const UNIQUE_VIOLATION = "23505";

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
  static async createGame(user, payload) {
    return runWithLogs(
      log,
      "createGame",
      () => ({ id_user: user?.id_user, platform: payload?.platform }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const gate = await this._assertEnabled("games");
        if (gate) return gate;

        const game = Subject.validateGame(payload);
        if (game.error) return { error: game.error, statusCode: 400 };
        // Sem nome próprio a comunidade se chama como o jogo — é o que a pessoa
        // esperaria ver. Sem jogo escolhido ainda, fica o rascunho, que o dono
        // troca no headcard.
        const { display_name, bio } = Subject.normalizeCommon(payload);
        const name = display_name || game.game_title || Subject.PLACEHOLDER_NAME.games;

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const community = await this._createShell(client, {
            id_user,
            kind: "games",
            display_name: name,
            bio,
            avatar_url: payload?.avatar_url,
          });
          const row = await SubjectCommunityStorage.createGame(
            client,
            community.id_profile,
            game
          );
          await client.query("COMMIT");
          return { community, game: row };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* noop */
          }
          log.error("createGame.fail", { id_user, error: err.message });
          return { error: "Não foi possível criar a comunidade do jogo." };
        } finally {
          client.release();
        }
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
   * Achar-ou-criar a comunidade de um modelo.
   *
   * "O primeiro que criar a comunidade daquele carro, ninguém cria mais"
   * (decisão do Alex). A garantia é o índice único, não este `if`: entre a
   * consulta e o INSERT cabe outro fundador. Por isso a violação 23505 é
   * TRATADA como sucesso — o segundo simplesmente entra na comunidade do
   * primeiro, que é o que ele queria de qualquer forma.
   */
  static async createOrJoinCar(user, payload) {
    return runWithLogs(
      log,
      "createOrJoinCar",
      () => ({ id_user: user?.id_user, brand: payload?.brand_code, model: payload?.model_code }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };
        const gate = await this._assertEnabled("car");
        if (gate) return gate;

        // Sem marca/modelo no corpo, a comunidade nasce VAZIA e o modelo é
        // escolhido no headcard (mig 211). É o caminho do menu da foto de
        // perfil: criar primeiro, perguntar depois, dentro da página.
        if (!payload?.brand_code && !payload?.model_code) {
          return this._createEmptyCar(id_user, payload);
        }

        const car = Subject.validateCar(payload);
        if (car.error) return { error: car.error, statusCode: 400 };

        // A FIPE manda nos rótulos quando responde. Quando não responde, o
        // cadastro continua com o que veio do cliente e a linha nasce
        // 'manual' — travar o carro na disponibilidade de um terceiro seria
        // pior do que aceitar um rótulo eventualmente torto.
        const check = await fipe.verifyModel(car);
        if (check.verified === false) {
          return { error: "Modelo não encontrado na tabela FIPE.", statusCode: 400 };
        }
        const model = {
          ...car,
          brand_label: check.brand_label || car.brand_label,
          model_label: check.model_label || car.model_label,
          source: check.verified ? "fipe" : "manual",
        };

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const catalog = await SubjectCommunityStorage.getOrCreateCarModel(client, model);

          const existing = await SubjectCommunityStorage.findCarCommunity(
            client,
            catalog.id_car_model
          );
          if (existing) {
            await client.query("ROLLBACK");
            const joined = await this._joinExisting(existing.id_profile, id_user);
            if (joined.error) return joined;
            return { community: existing, created: false, joined: true };
          }

          const community = await this._createShell(client, {
            id_user,
            kind: "car",
            display_name: Subject.carDisplayName(model),
            bio: Subject.normalizeCommon(payload).bio,
            avatar_url: payload?.avatar_url,
          });
          await SubjectCommunityStorage.attachCarModel(
            client,
            community.id_profile,
            catalog.id_car_model
          );
          await client.query("COMMIT");
          return {
            community: { ...community, ...catalog },
            created: true,
            joined: false,
          };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* noop */
          }
          if (err.code === UNIQUE_VIOLATION) {
            // Corrida perdida: outra pessoa fundou o mesmo modelo no meio do
            // caminho. Entrar na dela é o desfecho certo.
            const catalog = await SubjectCommunityStorage.getOrCreateCarModel(pool, model);
            const winner = await SubjectCommunityStorage.findCarCommunity(
              pool,
              catalog.id_car_model
            );
            if (winner) {
              const joined = await this._joinExisting(winner.id_profile, id_user);
              if (joined.error) return joined;
              return { community: winner, created: false, joined: true };
            }
          }
          log.error("createOrJoinCar.fail", { id_user, error: err.message });
          return { error: "Não foi possível abrir a comunidade desse carro." };
        } finally {
          client.release();
        }
      }
    );
  }

  /** Comunidade de carro sem modelo ainda — o dono escolhe dentro da página. */
  static async _createEmptyCar(id_user, payload) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const community = await this._createShell(client, {
        id_user,
        kind: "car",
        display_name:
          Subject.normalizeCommon(payload).display_name || Subject.PLACEHOLDER_NAME.car,
        bio: Subject.normalizeCommon(payload).bio,
        avatar_url: payload?.avatar_url,
      });
      await client.query("COMMIT");
      return { community, created: true, joined: false };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* noop */
      }
      log.error("createEmptyCar.fail", { id_user, error: err.message });
      return { error: "Não foi possível abrir a comunidade do carro." };
    } finally {
      client.release();
    }
  }

  // ─── Edição do assunto (dentro da página, sem modal) ────────────────────────
  /**
   * Troca o assunto de uma comunidade de pet/carro/games. Só o líder.
   *
   * O carro é o caso interessante: escolher o modelo é o momento em que a
   * unicidade passa a valer (até então `id_car_model` é NULL, e NULLs não
   * colidem). Se o modelo já tem dono, devolvemos 409 APONTANDO a comunidade
   * existente — o front oferece entrar nela, que é o que a pessoa queria.
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

        if (params.kind === "games") {
          const game = Subject.validateGame(payload);
          if (game.error) return { error: game.error, statusCode: 400 };
          const row = await SubjectCommunityStorage.upsertGame(pool, params.id_profile, game);
          if (game.game_title) {
            await SubjectCommunityStorage.renameIfPlaceholder(
              pool,
              params.id_profile,
              Subject.PLACEHOLDER_NAME.games,
              game.game_title
            );
          }
          return { subject: { kind: "games", ...row } };
        }

        // Carro
        const car = Subject.validateCar(payload);
        if (car.error) return { error: car.error, statusCode: 400 };
        const check = await fipe.verifyModel(car);
        if (check.verified === false) {
          return { error: "Modelo não encontrado na tabela FIPE.", statusCode: 400 };
        }
        const model = {
          ...car,
          brand_label: check.brand_label || car.brand_label,
          model_label: check.model_label || car.model_label,
          source: check.verified ? "fipe" : "manual",
        };
        const catalog = await SubjectCommunityStorage.getOrCreateCarModel(pool, model);

        const existing = await SubjectCommunityStorage.findCarCommunity(
          pool,
          catalog.id_car_model
        );
        if (existing && String(existing.id_profile) !== String(params.id_profile)) {
          return {
            error: "Esse modelo já tem comunidade.",
            statusCode: 409,
            existing_community: {
              id_profile: existing.id_profile,
              display_name: existing.display_name,
            },
          };
        }

        try {
          await SubjectCommunityStorage.attachCarModel(
            pool,
            params.id_profile,
            catalog.id_car_model
          );
        } catch (err) {
          if (err.code === UNIQUE_VIOLATION) {
            // Corrida perdida entre a consulta e o UPDATE: outra pessoa fincou
            // o mesmo modelo. Quem manda é o índice.
            const winner = await SubjectCommunityStorage.findCarCommunity(
              pool,
              catalog.id_car_model
            );
            return {
              error: "Esse modelo já tem comunidade.",
              statusCode: 409,
              existing_community: winner
                ? { id_profile: winner.id_profile, display_name: winner.display_name }
                : null,
            };
          }
          throw err;
        }

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

  /**
   * Entrada na comunidade do carro que já existe. Delega ao CommunityService
   * de propósito: quem sabe as regras de entrada (privada, teto, perfil) é
   * ele — duplicá-las aqui criaria uma segunda porta com regras próprias, que é
   * exatamente como o condomínio ganhou membro sem apartamento.
   */
  static async _joinExisting(id_profile, id_user) {
    const CommunityService = require("./CommunityService");
    const res = await CommunityService.join({ id_user }, { id_profile });
    if (res?.error) return res;
    return { ok: true };
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
