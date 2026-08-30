// src/services/CondoResidenceService.js
// O condomínio depois de absorvido pelo núcleo territorial (migs 205/206).
//
// Substitui a máquina de reivindicação da mig 196. A diferença que importa não
// é de código, é de regra:
//
//   antes  a unidade tinha UM titular; aprovar uma reivindicação transferia a
//          titularidade e o morador anterior perdia a unidade em silêncio (E1)
//   agora  a unidade tem MORADORES; quem chega não empurra ninguém para fora,
//          e quem sai sai por decisão humana, com motivo gravado
//
// Os dois caminhos quando o apartamento já tem gente:
//
//   ACEITAR COMO FAMÍLIA  o morador atual reconhece. Os dois moram. Um clique,
//         porque cônjuge/filho/irmão/colega de aluguel é o caso COMUM — tratar
//         o normal como exceção é o que faz software honesto parecer hostil.
//
//   REJEITAR E COMPETIR   contestação vira DISPUTA: abre uma conversa de três
//         (síndico + quem chegou + quem já estava), quem chegou filma o
//         comprovante e o síndico decide. Nada é decidido nas costas de
//         ninguém: quem é contestado lê a acusação e responde nela.
//
// Quatro invariantes que este arquivo não pode perder:
//
//   1. MORADOR é `status='recognized' AND ended_at IS NULL` — sempre as duas
//      metades. Meia condição transforma quem saiu em morador fantasma.
//   2. Nem contestar nem abrir disputa REMOVE alguém (§7.1). Só o veredito
//      remove, e veredito tem `decided_by` preenchido — um humano com nome.
//   3. Rua, número e CEP são sensíveis: `CondoRules` continua sendo a fonte
//      única, e nada aqui devolve endereço para quem não é morador.
//   4. Não existe visitante: entrar no condomínio É reivindicar um apartamento.
//      Quem só entrou e não confirmou lê, não escreve.

const pool = require("../databases");
const CondoResidenceStorage = require("../storages/CondoResidenceStorage");
const ResidenceStorage = require("../storages/ResidenceStorage");
const TerritoryStorage = require("../storages/TerritoryStorage");
const CommunityStorage = require("../storages/CommunityStorage");
const ConversationStorage = require("../storages/ConversationStorage");
const ProofStorage = require("../integrations/r2/residenceProofStorage");
const ResidenceService = require("./ResidenceService");
const NotificationService = require("./NotificationService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CondoResidenceService");

const MAX_BLOCK_NAME = 60;
const MAX_UNIT_LABEL = 40;

// Teto do gerador. Não é limite de prédio — é limite de ERRO DE DIGITAÇÃO: sem
// ele, "200 andares × 100 aptos" nasce como 20.000 linhas antes de alguém
// perceber que digitou o CEP no campo errado.
const MAX_GENERATED_UNITS = 2000;

// Comprovante filmado: mesmo teto do vídeo de story (80 MB).
const MAX_PROOF_BYTES = 80 * 1024 * 1024;

function clean(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function toInt(value, fallback = null) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Rótulo padrão do apartamento: andar + posição com dois dígitos (1º andar,
 * 2ª porta = "102"; 12º andar, 3ª porta = "1203").
 *
 * É CONVENÇÃO, não verdade — prédio real tem cobertura, loja, andar sem 13º e
 * numeração que não segue regra nenhuma. Por isso o gerador é ponto de partida
 * (§11.1) e o gestor edita, acrescenta e remove unidades depois.
 */
function defaultUnitLabel(floor, index) {
  return `${floor}${String(index).padStart(2, "0")}`;
}

class CondoResidenceService {
  /* ------------------------------- contexto ------------------------------ */

  /**
   * Condomínio + endereço + papel, numa chamada. Todo método público começa
   * aqui — é o que garante que nenhuma rota de condomínio responde sobre
   * comunidade comum, nem para quem não tem papel.
   *
   * `level`:
   *   'any'      — logado. Suficiente para VER a planta e escolher o apartamento
   *                (sem isso, entrar seria impossível: para reivindicar é
   *                preciso primeiro enxergar a grade).
   *   'resident' — morador reconhecido. Publica, vota, vê vizinhos.
   *   'admin'    — síndico (leader/vice). Decide disputa e edita a planta.
   */
  static async _context(conn, id_user, id_condo, { require: level = "any" } = {}) {
    if (!id_user) return { error: "Não autenticado.", statusCode: 401 };

    const r = await conn.query(
      `SELECT id_profile, display_name, community_kind, estado, municipio,
              condo_cep, condo_number, condo_neighborhood
         FROM public.tb_profile
        WHERE id_profile = $1
          AND is_community = TRUE
          AND community_kind = 'condo'
          AND deleted_at IS NULL
        LIMIT 1`,
      [id_condo]
    );
    if (!r.rowCount) return { error: "Condomínio não encontrado", statusCode: 404 };
    const condo = r.rows[0];

    const membership = await CommunityStorage.getMembership(conn, id_condo, id_user);
    const isAdmin = membership?.role === "leader" || membership?.role === "vice";

    const address = await this._resolveAddress(conn, condo);
    const resident = address
      ? await CondoResidenceStorage.getResidentContext(conn, {
          id_address: address.id_address,
          id_user,
        })
      : { recognized: false, pending: false, unrecognized: false, units: [] };

    if (level === "admin" && !isAdmin) {
      return { error: "Somente a administração do condomínio pode fazer isso.", statusCode: 403 };
    }
    if (level === "resident" && !isAdmin && !resident.recognized) {
      return {
        error: "Confirme seu apartamento para participar do condomínio.",
        statusCode: 403,
        needs_claim: true,
      };
    }
    return { condo, address, membership, isAdmin, resident };
  }

  /**
   * O endereço do condomínio na árvore territorial. A mig 205 já fez o backfill
   * do que dava; isto cobre os dois casos que ela não podia cobrir: condomínio
   * criado DEPOIS da migration e condomínio cujo endereço estava incompleto na
   * época e foi preenchido depois.
   *
   * Offline de propósito — nada de ViaCEP aqui. Bairro, cidade e UF já estão
   * nas colunas da mig 196, e chamar a rede num caminho quente faria a planta
   * do prédio depender da disponibilidade de um serviço de terceiro.
   */
  static async _resolveAddress(conn, condo) {
    const existing = await TerritoryStorage.getAddressByCondo(conn, condo.id_profile);
    if (existing) return existing;

    const cep = String(condo.condo_cep || "").replace(/\D/g, "");
    const numero = clean(condo.condo_number, 20);
    const uf = clean(condo.estado, 2);
    const municipio = clean(condo.municipio, 160);
    // Sem endereço completo não há árvore. Não é erro: é o gestor que ainda não
    // preencheu, e quem chama trata como `needs_address`.
    if (cep.length !== 8 || !numero || !uf || !municipio) return null;

    const bairro = clean(condo.condo_neighborhood, 160);
    const territory = await TerritoryStorage.getOrCreateTerritory(conn, {
      uf,
      municipio,
      bairro: bairro || "",
      is_city_wide: !bairro,
    });
    if (!territory) return null;

    const address = await TerritoryStorage.getOrCreateAddress(conn, {
      id_territory: territory.id_territory ?? territory.effective_id,
      cep,
      numero,
    });
    if (!address) return null;

    // Adoção (D12): o endereço pode já existir porque um morador de BAIRRO o
    // cadastrou antes. Ligar o condomínio a ele adota as unidades que já havia,
    // em vez de criar um prédio paralelo no mesmo número da mesma rua.
    if (!address.id_condo_profile) {
      await TerritoryStorage.setAddressCondo(conn, address.id_address, condo.id_profile);
      address.id_condo_profile = condo.id_profile;
    } else if (String(address.id_condo_profile) !== String(condo.id_profile)) {
      // Outro condomínio já ocupa este endereço. Não sequestramos: quem decide
      // qual é o verdadeiro é um humano.
      return null;
    }
    return address;
  }

  /* --------------------------------- planta ------------------------------ */

  /**
   * A planta. Projeção por papel, e a diferença é deliberada:
   *
   *   não-morador  vê a grade e se o apartamento está OCUPADO (booleano). É o
   *                mínimo para escolher onde mora — e o máximo que se pode dar
   *                a quem ainda não provou nada, porque contagem exata de
   *                moradores por porta é um mapa do prédio.
   *   morador      vê as contagens.
   *   síndico      vê nome e sobrenome de quem mora onde (`listResidents`).
   */
  static async getPlant(user, params) {
    return runWithLogs(
      log,
      "getPlant",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "any",
        });
        if (ctx.error) return ctx;

        if (!ctx.address) {
          return {
            needs_address: true,
            blocks: [],
            units: [],
            viewer: {
              is_admin: ctx.isAdmin,
              is_resident: false,
              is_pending: false,
              units: [],
            },
          };
        }

        const [blocks, rows] = await Promise.all([
          CondoResidenceStorage.listBlocks(pool, params.id_condo),
          CondoResidenceStorage.listPlant(pool, ctx.address.id_address),
        ]);

        const detailed = ctx.isAdmin || ctx.resident.recognized;
        const units = rows.map((u) => ({
          id_unit: u.id_unit,
          id_block: u.id_block,
          block_name: u.block_name,
          floor: u.floor,
          label: u.label,
          source: u.source,
          occupied: u.residents_count > 0,
          residents_count: detailed ? u.residents_count : undefined,
          pending_count: detailed ? u.pending_count : undefined,
        }));

        return {
          blocks,
          units,
          viewer: {
            is_admin: ctx.isAdmin,
            is_resident: ctx.resident.recognized,
            is_pending: ctx.resident.pending,
            is_unrecognized: ctx.resident.unrecognized,
            units: ctx.resident.units.map((u) => ({
              id_residence: u.id_residence,
              id_unit: u.id_unit,
              status: u.status,
              label: u.label,
              floor: u.floor,
              block_name: u.block_name,
            })),
          },
        };
      }
    );
  }

  /**
   * Cria a torre e, quando o gestor informa a grade, GERA os apartamentos
   * (D10). Uma transação só: torre sem as unidades dela deixaria o morador
   * olhando para um bloco vazio sem entender por quê.
   */
  static async createBlock(user, params, body) {
    return runWithLogs(
      log,
      "createBlock",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "admin",
        });
        if (ctx.error) return ctx;
        if (!ctx.address) {
          return {
            error: "Complete o endereço do condomínio (CEP e número) antes de montar a planta.",
            statusCode: 409,
            needs_address: true,
          };
        }

        const name = clean(body?.name, MAX_BLOCK_NAME);
        if (!name) return { error: "Informe o nome do bloco.", statusCode: 400 };

        const floors = toInt(body?.floors);
        const perFloor = toInt(body?.units_per_floor);
        const firstFloor = toInt(body?.first_floor, 1);

        if (floors !== null || perFloor !== null) {
          if (!floors || floors < 1 || floors > 200) {
            return { error: "Número de andares inválido (1 a 200).", statusCode: 400 };
          }
          if (!perFloor || perFloor < 1 || perFloor > 100) {
            return { error: "Apartamentos por andar inválido (1 a 100).", statusCode: 400 };
          }
          if (floors * perFloor > MAX_GENERATED_UNITS) {
            return {
              error: `A planta geraria ${floors * perFloor} apartamentos — o limite é ${MAX_GENERATED_UNITS}. Cadastre torres separadas.`,
              statusCode: 400,
            };
          }
          if (firstFloor < -20 || firstFloor > 300) {
            return { error: "Andar inicial inválido.", statusCode: 400 };
          }
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const created = await client.query(
            `INSERT INTO public.tb_condo_block (id_condo, name)
                  VALUES ($1, $2::text)
             ON CONFLICT (id_condo, lower(name)) DO NOTHING
             RETURNING *`,
            [params.id_condo, name]
          );
          let block = created.rowCount ? created.rows[0] : null;
          if (!block) {
            const found = await client.query(
              `SELECT * FROM public.tb_condo_block
                WHERE id_condo = $1 AND lower(name) = lower($2::text)
                LIMIT 1`,
              [params.id_condo, name]
            );
            block = found.rows[0];
          }
          if (!block) {
            await client.query("ROLLBACK");
            return { error: "Não foi possível criar o bloco." };
          }

          let generated = 0;
          if (floors && perFloor) {
            // Por andar, e não tudo de uma vez: o andar precisa ser carimbado
            // por leva, e agrupar assim mantém uma escrita por andar em vez de
            // uma por apartamento.
            for (let f = 0; f < floors; f += 1) {
              const floor = firstFloor + f;
              const labels = [];
              for (let i = 1; i <= perFloor; i += 1) {
                labels.push(defaultUnitLabel(floor, i));
              }
              await TerritoryStorage.bulkCreateUnits(
                client,
                ctx.address.id_address,
                labels.map((label) => ({ id_block: block.id_block, label }))
              );
              await CondoResidenceStorage.setFloorForLabels(client, {
                id_block: block.id_block,
                floor,
                labels,
              });
              generated += labels.length;
            }
            block = await CondoResidenceStorage.setBlockGrid(client, {
              id_block: block.id_block,
              floors,
              units_per_floor: perFloor,
              first_floor: firstFloor,
            });
          }

          await client.query("COMMIT");
          return { block, generated };
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          log.error("createBlock.fail", { error: err.message });
          return { error: "Não foi possível criar o bloco." };
        } finally {
          client.release();
        }
      }
    );
  }

  /** Apartamento avulso: a cobertura, a loja, o 13º que o gerador não previu. */
  static async createUnit(user, params, body) {
    return runWithLogs(
      log,
      "createUnit",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "admin",
        });
        if (ctx.error) return ctx;
        if (!ctx.address) {
          return {
            error: "Complete o endereço do condomínio antes de montar a planta.",
            statusCode: 409,
            needs_address: true,
          };
        }

        const label = clean(body?.label ?? body?.number, MAX_UNIT_LABEL);
        if (!label) return { error: "Informe o número do apartamento.", statusCode: 400 };
        const id_block = body?.id_block ? toInt(body.id_block) : null;
        const floor = body?.floor === undefined || body?.floor === null ? null : toInt(body.floor);

        if (id_block) {
          const block = await CondoResidenceStorage.getBlock(pool, params.id_condo, id_block);
          if (!block) return { error: "Bloco não encontrado.", statusCode: 404 };
        }

        const unit = await TerritoryStorage.getOrCreateUnit(pool, {
          id_address: ctx.address.id_address,
          id_block,
          label,
          source: "generated",
        });
        if (!unit) return { error: "Não foi possível criar o apartamento." };
        if (floor !== null) {
          await CondoResidenceStorage.setUnitFloor(pool, unit.id_unit, floor);
          unit.floor = floor;
        }
        return { unit };
      }
    );
  }

  /**
   * Remove um apartamento da planta. Recusa enquanto houver morador vivo — a
   * FK é CASCADE em cadeia (mig 202), então sem este guard o banco apagaria o
   * vínculo do morador sem `ended_at`, sem motivo e sem avisar ninguém. É o
   * mesmo guard do `CondoService.deleteBlock`, pela mesma razão.
   */
  static async deleteUnit(user, params) {
    return runWithLogs(
      log,
      "deleteUnit",
      () => ({ id_user: user?.id_user, id_unit: params?.id_unit }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "admin",
        });
        if (ctx.error) return ctx;
        if (!ctx.address) return { error: "Condomínio sem endereço.", statusCode: 409 };

        const residents = await CondoResidenceStorage.listUnitResidents(
          pool,
          params.id_unit
        );
        if (residents.length > 0) {
          return {
            error:
              residents.length === 1
                ? "Há 1 morador vinculado a este apartamento. Remova o vínculo antes de excluí-lo."
                : `Há ${residents.length} moradores vinculados a este apartamento. Remova os vínculos antes de excluí-lo.`,
            statusCode: 409,
            residents: residents.length,
          };
        }

        const ok = await CondoResidenceStorage.deleteUnit(pool, {
          id_address: ctx.address.id_address,
          id_unit: params.id_unit,
        });
        return { ok };
      }
    );
  }

  /* ------------------------------ reivindicação --------------------------- */

  /**
   * Entrar no condomínio. Não existe "entrar e ver depois": escolher o
   * apartamento É a entrada.
   *
   * Vazio    → reconhecido na hora (degrau 0). Sem fricção: não há ninguém do
   *            outro lado para aprovar.
   * Ocupado  → pendente, e os moradores atuais decidem: família ou disputa.
   */
  static async claimUnit(user, params, body) {
    return runWithLogs(
      log,
      "claimUnit",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "any",
        });
        if (ctx.error) return ctx;
        if (!ctx.address) {
          return {
            error: "Este condomínio ainda não tem endereço cadastrado. Fale com a administração.",
            statusCode: 409,
            needs_address: true,
          };
        }

        const id_unit = toInt(body?.id_unit);
        if (!id_unit) return { error: "Escolha um apartamento.", statusCode: 400 };

        // A unidade tem que ser DESTE prédio. Sem esta checagem, um id de
        // unidade de outro endereço viraria vínculo aqui.
        const unit = await TerritoryStorage.getUnitById(pool, id_unit);
        if (!unit || String(unit.id_address) !== String(ctx.address.id_address)) {
          return { error: "Apartamento não encontrado neste condomínio.", statusCode: 404 };
        }

        const result = await ResidenceService.claimKnownUnit({
          id_user: user.id_user,
          id_unit,
        });
        if (result?.error) return result;

        const link = result.residence;

        // Membro da comunidade a partir daqui — mas MORADOR só quando
        // reconhecido. Quem está pendente lê o feed e não publica, que é
        // exatamente o degrau 2 do desenho.
        await CommunityStorage.addMember(pool, params.id_condo, user.id_user, "member");

        if (link.status === "pending") {
          const neighbors = await ResidenceStorage.listRecognizedInUnit(pool, id_unit, {
            exclude_user: user.id_user,
          });
          for (const n of neighbors) {
            NotificationService.notifyCondoFamilyRequest({
              recipient_user_id: n.id_user,
              actor_user_id: user.id_user,
              id_residence: link.id_residence,
              id_condo: params.id_condo,
              condo_name: ctx.condo.display_name,
            }).catch(() => {});
          }
        }

        return {
          residence: {
            id_residence: link.id_residence,
            id_unit: link.id_unit,
            status: link.status,
          },
          status: link.status,
        };
      }
    );
  }

  /**
   * A decisão do morador atual sobre quem diz morar com ele.
   *
   *   'family'  → reconhece. Acabou: os dois moram.
   *   'contest' → contesta E abre a disputa. A contestação sozinha (mig 203)
   *               só marca divergência e espera decisão humana; no condomínio
   *               existe alguém para decidir — o síndico — então a disputa
   *               nasce junto, com a conversa dos três, senão a divergência
   *               ficaria parada sem ninguém encarregado dela.
   */
  static async respondToClaim(user, params, body) {
    return runWithLogs(
      log,
      "respondToClaim",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo, action: body?.action }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "any",
        });
        if (ctx.error) return ctx;

        const id_residence = toInt(params?.id_residence ?? body?.id_residence);
        if (!id_residence) return { error: "Vínculo não informado.", statusCode: 400 };

        const action = String(body?.action || "").trim();
        if (!["family", "contest"].includes(action)) {
          return { error: "Ação inválida.", statusCode: 400 };
        }

        const target = await ResidenceStorage.getById(pool, id_residence);
        if (!target || target.ended_at) {
          return { error: "Vínculo não encontrado.", statusCode: 404 };
        }
        // O vínculo tem que ser deste prédio — senão qualquer morador de
        // qualquer endereço julgaria qualquer reivindicação do sistema.
        const unit = await TerritoryStorage.getUnitById(pool, target.id_unit);
        if (
          !ctx.address ||
          !unit ||
          String(unit.id_address) !== String(ctx.address.id_address)
        ) {
          return { error: "Vínculo não encontrado neste condomínio.", statusCode: 404 };
        }

        if (action === "family") {
          // ResidenceService.recognize aplica os guards de quem pode julgar
          // (morador reconhecido da MESMA unidade, maior de idade, nunca sobre
          // si mesmo). Não reimplementar aqui.
          return ResidenceService.recognize({ id_residence, id_user: user.id_user });
        }

        const contested = await ResidenceService.contest({
          id_residence,
          id_user: user.id_user,
          reason: body?.reason ?? null,
        });
        if (contested?.error) return contested;

        const dispute = await this._openDispute({
          condo: ctx.condo,
          id_unit: target.id_unit,
          id_residence,
          id_claimant: target.id_user,
          id_contester: user.id_user,
          reason: body?.reason ?? null,
        });

        return { residence: contested.residence, dispute };
      }
    );
  }

  /**
   * Abre a disputa e monta a conversa dos três. A conversa é criada pelo
   * SISTEMA, não por um usuário: quem contesta não é dono do subperfil do
   * síndico, então o caminho normal de criação de grupo (que exige posse do
   * perfil dono) recusaria — e recusar aqui deixaria a disputa sem o lugar
   * onde o contraditório acontece.
   */
  static async _openDispute({
    condo,
    id_unit,
    id_residence,
    id_claimant,
    id_contester,
    reason,
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const dispute = await CondoResidenceStorage.createDispute(client, {
        id_condo: condo.id_profile,
        id_unit,
        id_residence,
        id_claimant,
        id_contester,
        reason: clean(reason, 500),
      });
      if (!dispute) {
        await client.query("ROLLBACK");
        return null;
      }

      // Já tinha conversa (contestação repetida): reusa. Contestar duas vezes
      // continua sendo a mesma disputa, no mesmo lugar.
      if (!dispute.id_conversation) {
        const leaders = await this._adminUserIds(client, condo.id_profile);
        const profiles = await this._accountProfiles(client, [
          ...leaders,
          id_claimant,
          id_contester,
        ]);
        const ownerProfile =
          profiles.get(String(leaders[0] || "")) ||
          profiles.get(String(id_contester)) ||
          null;

        if (ownerProfile) {
          const group = await ConversationStorage.createGroup(client, {
            owner_profile_id: ownerProfile,
            // §11: o nome do grupo NÃO cita o apartamento. Ele aparece na lista
            // de conversas de três pessoas e no push — é exatamente o lugar por
            // onde o número da porta escaparia.
            name: `Reivindicação — ${String(condo.display_name || "condomínio").slice(0, 90)}`,
            cover_url: null,
            max_members: 10,
          });
          const seen = new Set();
          for (const uid of [...leaders, id_claimant, id_contester]) {
            const pid = profiles.get(String(uid));
            if (!pid || seen.has(pid)) continue;
            seen.add(pid);
            await ConversationStorage.addGroupMember(client, {
              id_conversation: group.id_conversation,
              profile_id: pid,
              role: pid === ownerProfile ? "owner" : "member",
            });
          }
          await CondoResidenceStorage.setDisputeConversation(
            client,
            dispute.id_dispute,
            group.id_conversation
          );
          dispute.id_conversation = group.id_conversation;
        } else {
          // Não deveria acontecer (todo usuário tem perfil-conta). Se acontecer,
          // a disputa existe e o síndico decide pelo painel — mas SEM o lugar
          // onde as partes se falam. Fica gritado no log em vez de silencioso.
          log.warn("openDispute.no_conversation", {
            id_dispute: dispute.id_dispute,
            id_condo: condo.id_profile,
          });
        }
      }

      await client.query("COMMIT");

      const leaders = await this._adminUserIds(pool, condo.id_profile);
      for (const recipient of [...leaders, id_claimant, id_contester]) {
        NotificationService.notifyCondoDisputeOpened({
          recipient_user_id: recipient,
          actor_user_id: id_contester,
          id_condo: condo.id_profile,
          id_dispute: dispute.id_dispute,
          condo_name: condo.display_name,
        }).catch(() => {});
      }

      return dispute;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      log.error("openDispute.fail", { error: err.message });
      return null;
    } finally {
      client.release();
    }
  }

  /* ------------------------------ comprovante ----------------------------- */

  /**
   * O comprovante filmado. Quem envia é quem está reivindicando; quem assiste é
   * o SÍNDICO (decisão do Alex, 2026-08-29 — diverge do D13 de propósito: no
   * bairro o gestor é um vizinho, no condomínio o líder é o síndico, que já
   * responde por quem entra no prédio). O admin da plataforma continua vendo a
   * fila, para auditoria.
   *
   * O arquivo NÃO vira mensagem do chat: na conversa entra o aviso de que
   * chegou. O vídeo mora em `tb_residence_proof`, com `purge_after` — é lixo
   * tóxico depois do veredito.
   */
  static async submitProof(user, params, file) {
    return runWithLogs(
      log,
      "submitProof",
      // O nome do arquivo NÃO entra no log: comprovante costuma vir com o nome
      // do titular no arquivo, e log é exatamente onde isso sobrevive.
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo, size: file?.size }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "any",
        });
        if (ctx.error) return ctx;

        const id_dispute = toInt(params?.id_dispute);
        if (!id_dispute) return { error: "Disputa não informada.", statusCode: 400 };
        if (!file?.buffer?.length) {
          return { error: "Envie o vídeo do comprovante.", statusCode: 400 };
        }

        const ext = ProofStorage.extForMime(file.mimetype);
        if (!ext) {
          return {
            error: "Envie um vídeo (MP4, MOV ou WebM) — o comprovante precisa ser filmado.",
            statusCode: 400,
          };
        }
        if (file.buffer.length > MAX_PROOF_BYTES) {
          return { error: "O vídeo excede o tamanho máximo (80 MB).", statusCode: 400 };
        }

        const dispute = await CondoResidenceStorage.getDisputeById(pool, id_dispute);
        if (!dispute || String(dispute.id_condo) !== String(params.id_condo)) {
          return { error: "Disputa não encontrada.", statusCode: 404 };
        }
        if (dispute.status !== "open") {
          return { error: "Esta disputa já foi decidida.", statusCode: 409 };
        }
        if (String(dispute.id_claimant) !== String(user.id_user)) {
          return {
            error: "Só quem está reivindicando envia o comprovante.",
            statusCode: 403,
          };
        }

        // Sobe primeiro, grava depois: se a gravação falhar sobra um objeto
        // órfão (que o expurgo não conhece, mas que também não aponta para
        // ninguém). O inverso — linha apontando para um objeto que não subiu —
        // faria o síndico abrir um vídeo inexistente e decidir no escuro.
        const key = ProofStorage.buildKey(params.id_condo, ext);
        await ProofStorage.putObject(key, file.buffer, file.mimetype);

        const proof = await ResidenceStorage.createProof(pool, {
          id_residence: dispute.id_residence,
          storage_key: key,
          requested_by: dispute.id_contester,
          reviewer_scope: "condo_leader",
          id_condo: params.id_condo,
          media_kind: "video",
        });

        const leaders = await this._adminUserIds(pool, params.id_condo);
        for (const leader of leaders) {
          NotificationService.notifyCondoProofSubmitted({
            recipient_user_id: leader,
            actor_user_id: user.id_user,
            id_condo: params.id_condo,
            id_dispute,
            condo_name: ctx.condo.display_name,
          }).catch(() => {});
        }

        return { proof: { id_proof: proof.id_proof, status: proof.status } };
      }
    );
  }

  /**
   * A URL para assistir. Emitida por chamada e de vida curta — nunca guardada,
   * nunca devolvida em listagem. Quem pode: o síndico do prédio e o admin da
   * plataforma (auditoria). O contestante NÃO assiste: ele levantou a dúvida,
   * não ganhou com isso o direito de ver o documento do vizinho.
   */
  static async getProofUrl(user, params) {
    return runWithLogs(
      log,
      "getProofUrl",
      () => ({ id_user: user?.id_user, id_proof: params?.id_proof }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "admin",
        });
        if (ctx.error) return ctx;

        const r = await pool.query(
          `SELECT id_proof, storage_key, id_condo, purged_at
             FROM public.tb_residence_proof
            WHERE id_proof = $1
            LIMIT 1`,
          [toInt(params?.id_proof)]
        );
        if (!r.rowCount) return { error: "Comprovante não encontrado.", statusCode: 404 };
        const proof = r.rows[0];
        if (String(proof.id_condo || "") !== String(params.id_condo)) {
          return { error: "Comprovante não encontrado.", statusCode: 404 };
        }
        if (proof.purged_at || !proof.storage_key) {
          return { error: "Este comprovante já foi expurgado.", statusCode: 410 };
        }

        const url = await ProofStorage.presignView(proof.storage_key);
        return { url, expires_in: 300 };
      }
    );
  }

  /* -------------------------------- disputa ------------------------------- */

  static async listDisputes(user, params, query) {
    return runWithLogs(
      log,
      "listDisputes",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "any",
        });
        if (ctx.error) return ctx;

        // Síndico vê a fila do prédio. Quem não é vê só as disputas em que ele
        // é parte — ninguém acompanha briga alheia.
        if (!ctx.isAdmin) {
          const mine = await CondoResidenceStorage.listDisputesForUser(pool, user.id_user);
          return {
            disputes: mine.filter(
              (d) => String(d.id_condo) === String(params.id_condo)
            ),
            is_admin: false,
          };
        }

        const status = ["open", "approved", "rejected", "withdrawn", "all"].includes(
          query?.status
        )
          ? query.status
          : "open";
        const disputes = await CondoResidenceStorage.listDisputes(pool, {
          id_condo: params.id_condo,
          status,
        });
        return { disputes, is_admin: true };
      }
    );
  }

  /**
   * O veredito do síndico. É o ÚNICO caminho pelo qual alguém perde a
   * residência neste fluxo, e por isso grava quem decidiu: `decided_by` não é
   * auditoria decorativa — é a diferença entre uma decisão e um efeito colateral.
   *
   * Aprovar  → quem reivindicou vira morador reconhecido. Quem contestou
   *            CONTINUA morador: aprovar um não expulsa o outro (§7.1). Se o
   *            síndico quiser remover alguém, isso é um ato à parte, explícito.
   * Recusar  → o vínculo de quem reivindicou encerra com motivo 'rejected'.
   */
  static async decideDispute(user, params, body) {
    return runWithLogs(
      log,
      "decideDispute",
      () => ({ id_user: user?.id_user, id_dispute: params?.id_dispute, action: body?.action }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "admin",
        });
        if (ctx.error) return ctx;

        const id_dispute = toInt(params?.id_dispute);
        const action = String(body?.action || "").trim();
        if (!["approve", "reject"].includes(action)) {
          return { error: "Ação inválida.", statusCode: 400 };
        }

        const dispute = await CondoResidenceStorage.getDisputeById(pool, id_dispute);
        if (!dispute || String(dispute.id_condo) !== String(params.id_condo)) {
          return { error: "Disputa não encontrada.", statusCode: 404 };
        }
        if (dispute.status !== "open") {
          return { error: "Esta disputa já foi decidida.", statusCode: 409 };
        }

        const note = clean(body?.note, 500);
        const approved = action === "approve";

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const decided = await CondoResidenceStorage.decideDispute(client, {
            id_dispute,
            status: approved ? "approved" : "rejected",
            decided_by: user.id_user,
            note,
          });
          if (!decided) {
            await client.query("ROLLBACK");
            return { error: "Esta disputa já foi decidida.", statusCode: 409 };
          }

          if (approved) {
            await ResidenceStorage.setStatus(client, dispute.id_residence, "recognized", {
              recognized_by: user.id_user,
            });
          } else {
            await ResidenceStorage.endLink(client, dispute.id_residence, {
              reason: "rejected",
              by_user: user.id_user,
            });
          }

          // O comprovante segue o veredito: aprovado/recusado junto, e o
          // purge_after começa a correr a partir daqui.
          const proofs = await client.query(
            `SELECT id_proof FROM public.tb_residence_proof
              WHERE id_residence = $1 AND status = 'pending'`,
            [dispute.id_residence]
          );
          for (const row of proofs.rows) {
            await ResidenceStorage.decideProof(client, {
              id_proof: row.id_proof,
              status: approved ? "approved" : "rejected",
              note,
              reviewed_by: user.id_user,
            });
          }

          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          log.error("decideDispute.fail", { error: err.message });
          return { error: "Não foi possível registrar a decisão." };
        } finally {
          client.release();
        }

        if (approved) {
          // Reconhecido agora: os menores sob supervisão dele herdam a
          // residência (D15), como em qualquer outro reconhecimento.
          ResidenceService.syncMinors({
            id_user: dispute.id_claimant,
            id_unit: dispute.id_unit,
          }).catch(() => {});
        }

        for (const recipient of [dispute.id_claimant, dispute.id_contester]) {
          NotificationService.notifyCondoDisputeDecided({
            recipient_user_id: recipient,
            actor_user_id: user.id_user,
            id_condo: params.id_condo,
            id_dispute,
            approved,
            condo_name: ctx.condo.display_name,
          }).catch(() => {});
        }

        return { ok: true, status: approved ? "approved" : "rejected" };
      }
    );
  }

  /* -------------------------------- vizinhos ------------------------------ */

  /**
   * Os vizinhos. Só morador vê a lista, e a UNIDADE de cada um só sai para a
   * administração — saber que o Pedro mora aqui é vida em condomínio; saber
   * que ele mora no 302 é outra coisa.
   */
  static async listResidents(user, params) {
    return runWithLogs(
      log,
      "listResidents",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "resident",
        });
        if (ctx.error) return ctx;
        if (!ctx.address) return { residents: [], total: 0 };

        const residents = await CondoResidenceStorage.listCondoResidents(pool, {
          id_address: ctx.address.id_address,
          with_unit: ctx.isAdmin,
        });
        return { residents, total: residents.length };
      }
    );
  }

  /* ------------------------------- internos ------------------------------- */

  static async _adminUserIds(conn, id_condo) {
    const members = await CommunityStorage.listMembers(conn, id_condo);
    return members
      .filter((m) => m.role === "leader" || m.role === "vice")
      .map((m) => m.id_user);
  }

  /**
   * user → o perfil que fala por ele numa conversa.
   *
   * Preferência é o perfil-conta (`is_user_account`), que todo mundo tem,
   * inclusive quem nunca criou subperfil — usar "o primeiro subperfil" deixaria
   * de fora exatamente quem só usa a conta, que é o morador típico.
   *
   * O FALLBACK para um subperfil comum não é preciosismo: sem ele, um único
   * participante sem perfil-conta fazia a conversa da disputa não nascer, em
   * silêncio — e a conversa é onde o contraditório acontece. Perder o
   * contraditório porque uma linha de perfil faltava é o pior jeito de falhar.
   * Clan e comunidade ficam de fora: são entidades coletivas, não a pessoa.
   */
  static async _accountProfiles(conn, userIds) {
    const ids = [...new Set(userIds.filter(Boolean).map(String))];
    const map = new Map();
    if (ids.length === 0) return map;
    const r = await conn.query(
      `SELECT DISTINCT ON (id_user) id_user, id_profile
         FROM public.tb_profile
        WHERE id_user = ANY($1::uuid[])
          AND deleted_at IS NULL
          AND is_clan = FALSE
          AND is_community = FALSE
        ORDER BY id_user, is_user_account DESC, created_at`,
      [ids]
    );
    for (const row of r.rows) map.set(String(row.id_user), row.id_profile);
    return map;
  }
}

module.exports = CondoResidenceService;
