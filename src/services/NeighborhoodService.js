// src/services/NeighborhoodService.js
// Bairro como modalidade de comunidade (mig 204). Subsistema 4 do desenho.
//
// É a primeira modalidade a usar o núcleo inteiro: o território (mig 202) diz
// ONDE, o vínculo de morador (mig 203) diz QUEM. Aqui não se decide nada sobre
// residência — só se CONSULTA. É isso que permite o condomínio migrar depois
// (subsistema 5) sem reescrever este arquivo: o predicado é o mesmo, muda só o
// escopo (bairro → território; condomínio → endereço).
//
// O predicado que amarra tudo (§4.2):
//   MORADOR é quem tem vínculo RECONHECIDO numa unidade cujo endereço pertence
//   ao escopo da comunidade.

const pool = require("../databases");
const NeighborhoodStorage = require("../storages/NeighborhoodStorage");
const CommunityStorage = require("../storages/CommunityStorage");
const FeatureFlagService = require("./FeatureFlagService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("NeighborhoodService");

class NeighborhoodService {
  /**
   * Cria a comunidade oficial do bairro.
   *
   * Só um MORADOR RECONHECIDO do território pode criar: sem isso, qualquer um
   * fundaria o bairro dos outros e viraria gestor de um lugar onde não mora —
   * e como só existe UMA comunidade por bairro (índice único da mig 204), essa
   * fundação seria irreversível na prática.
   *
   * Bairro fica FORA do gate de nível 5 e dos tetos de criar/participar, pela
   * mesma razão do condomínio: não é comunidade de enxame, é utilidade do lugar
   * onde a pessoa mora. Ninguém pode ficar sem a comunidade do próprio bairro
   * por já participar de outras.
   */
  static async create(user, { display_name, bio = null, avatar_url = null }) {
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user }), async () => {
      const id_user = user?.id_user;
      if (!id_user) return { error: "Usuário não autenticado.", statusCode: 401 };

      if (!(await FeatureFlagService.isEnabled("bairro"))) {
        return { error: "Recurso indisponível no momento.", statusCode: 403 };
      }

      const territories = await NeighborhoodStorage.listTerritoriesForResident(
        pool,
        id_user
      );
      if (territories.length === 0) {
        return {
          error:
            "Só quem mora no bairro pode criar a comunidade dele. Declare sua residência primeiro.",
          statusCode: 403,
        };
      }
      // Um morador reconhecido pode morar em mais de um lugar; o bairro criado
      // é o do vínculo, e o vínculo é único por território aqui.
      const territory = territories[0];

      const existing = await NeighborhoodStorage.getByTerritory(
        pool,
        territory.id_territory
      );
      if (existing) {
        return {
          error: "Este bairro já tem comunidade.",
          statusCode: 409,
          id_profile: existing.id_profile,
        };
      }

      const name =
        String(display_name || "").trim() ||
        `${territory.bairro_label} · ${territory.municipio_label}`;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const community = await NeighborhoodStorage.createNeighborhood(client, {
          id_user,
          id_territory: territory.id_territory,
          display_name: name.slice(0, 120),
          bio: bio ? String(bio).trim().slice(0, 200) : null,
          avatar_url,
        });
        await CommunityStorage.addMember(client, community.id_profile, id_user, "leader");
        await client.query("COMMIT");
        return { community };
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* conexão pode estar inutilizável */
        }
        // A corrida entre dois fundadores cai aqui: o índice único fez o
        // trabalho, e a resposta é "já existe", não erro 500.
        if (err?.code === "23505") {
          const other = await NeighborhoodStorage.getByTerritory(
            pool,
            territory.id_territory
          );
          return {
            error: "Este bairro já tem comunidade.",
            statusCode: 409,
            id_profile: other?.id_profile || null,
          };
        }
        throw err;
      } finally {
        client.release();
      }
    });
  }

  /**
   * Entrar. Não existe "pedir para entrar" no bairro: quem mora, entra; quem
   * não mora, não. A porta é a residência reconhecida — o que transforma a
   * comunidade de bairro em algo que não dá para fingir de fora.
   */
  static async join(user, { id_profile }) {
    return runWithLogs(
      log,
      "join",
      () => ({ id_user: user?.id_user, id_profile }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado.", statusCode: 401 };

        const community = await NeighborhoodStorage.getById(pool, id_profile);
        if (!community) return { error: "Comunidade não encontrada.", statusCode: 404 };

        const status = await NeighborhoodStorage.getResidentStatus(pool, {
          id_territory: community.id_territory,
          id_user,
        });
        if (!status.recognized) {
          return {
            error: status.linked
              ? "Sua residência ainda não foi reconhecida pelos vizinhos."
              : "Só moradores do bairro entram nesta comunidade.",
            statusCode: 403,
            residence_status: status.status,
          };
        }

        await CommunityStorage.addMember(pool, id_profile, id_user, "member");
        return { joined: true };
      }
    );
  }

  /**
   * Descoberta por (cidade, bairro) — NUNCA por rua (D5, e o que fecha o
   * vazamento C4). O que sai daqui é o mínimo para a pessoa reconhecer o
   * próprio bairro: nome, cidade e UF. Sem contagem de membros, sem atividade,
   * sem endereço.
   */
  static async discover({ uf, municipio, q = null, limit = 50 }) {
    if (!(await FeatureFlagService.isEnabled("bairro"))) {
      return { neighborhoods: [] };
    }
    if (!uf || !municipio) {
      return { error: "Informe estado e cidade.", statusCode: 400 };
    }
    const rows = await NeighborhoodStorage.discover(pool, { uf, municipio, q, limit });
    return { neighborhoods: rows };
  }

  /**
   * Os bairros do usuário: onde ele mora, com a comunidade se já existir.
   * Alimenta o card da tela — inclusive o estado "seu bairro ainda não tem
   * comunidade, crie a primeira".
   */
  static async mine(user) {
    const id_user = user?.id_user;
    if (!id_user) return { error: "Usuário não autenticado.", statusCode: 401 };
    const rows = await NeighborhoodStorage.listMine(pool, id_user);
    return { neighborhoods: rows };
  }

  /**
   * Escopo de morador do bairro, para o CommunityService resolver o tier sem
   * saber o que é território. Mesma forma do `getResidentStatus` do condomínio
   * de propósito: quando o subsistema 5 unificar os dois, o chamador não muda.
   */
  static async residentStatusForCommunity(id_profile, id_user) {
    if (!id_user || !id_profile) return { confirmed: false };
    const community = await NeighborhoodStorage.getById(pool, id_profile);
    if (!community?.id_territory) return { confirmed: false };
    const status = await NeighborhoodStorage.getResidentStatus(pool, {
      id_territory: community.id_territory,
      id_user,
    });
    return { confirmed: status.recognized, status: status.status };
  }
}

module.exports = NeighborhoodService;
