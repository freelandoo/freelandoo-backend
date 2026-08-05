// src/services/CondoService.js
// Regras do Condomínio (migs 196/197): estrutura (blocos/unidades/vagas),
// reivindicação de unidade e vaga, e avisos gerais/direcionados.
//
// Três papéis, e a diferença entre eles é o coração da privacidade da feature:
//   * visitante  — vê nome, bairro/cidade. Nada de rua, nada de morador.
//   * membro     — entrou no condomínio mas ainda não teve unidade aprovada.
//   * morador    — titular de ao menos 1 unidade (confirmed). Só ele publica
//                  aviso, anúncio e vota em enquete.
//   * administrador — líder/vice da comunidade: decide reivindicações e é o
//                  único que enxerga QUEM mora em QUAL unidade.

const pool = require("../databases");
const CondoStorage = require("../storages/CondoStorage");
const CommunityStorage = require("../storages/CommunityStorage");
const NotificationService = require("./NotificationService");
const CondoRules = require("../utils/condoRules");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CondoService");

const MAX_UNIT_NUMBER = 20;
const MAX_SPOT_CODE = 20;
const MAX_BLOCK_NAME = 60;
const MAX_NOTICE_BODY = 2000;
const MAX_NOTICE_TITLE = 120;

function clean(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

class CondoService {
  /* ------------------------------- contexto ------------------------------ */

  // Resolve condomínio + papel do usuário de uma vez. Todo método público
  // começa por aqui — é o que garante que nenhuma rota de condomínio responde
  // sobre comunidade comum nem para quem não tem papel.
  static async _context(conn, id_user, id_condo, { require: level = "member" } = {}) {
    const condo = await CondoStorage.getCondo(conn, id_condo);
    if (!condo) return { error: "Condomínio não encontrado", statusCode: 404 };

    const membership = id_user
      ? await CommunityStorage.getMembership(conn, id_condo, id_user)
      : null;
    const isAdmin = membership?.role === "leader" || membership?.role === "vice";
    const resident = await CondoStorage.getResidentStatus(conn, id_condo, id_user);

    if (level === "admin" && !isAdmin) {
      return { error: "Somente a administração do condomínio pode fazer isso.", statusCode: 403 };
    }
    if (level === "resident" && !isAdmin && !resident.confirmed) {
      return {
        error: "Confirme sua unidade para participar do condomínio.",
        statusCode: 403,
        needs_claim: true,
      };
    }
    if (level === "member" && !membership && !isAdmin) {
      return { error: "Entre no condomínio para ver esta área.", statusCode: 403 };
    }
    return { condo, membership, isAdmin, resident };
  }

  static async _adminUserIds(conn, id_condo) {
    const members = await CommunityStorage.listMembers(conn, id_condo);
    return members
      .filter((m) => m.role === "leader" || m.role === "vice")
      .map((m) => m.id_user);
  }

  /* ------------------------------- estrutura ----------------------------- */

  // Planta do condomínio. Morador vê blocos/unidades/vagas e o que está
  // ocupado (para saber o que pode reivindicar) — mas o NOME do titular só
  // sai para a administração.
  static async getStructure(user, params) {
    return runWithLogs(
      log,
      "getStructure",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "member",
        });
        if (ctx.error) return ctx;

        const [blocks, units, parking] = await Promise.all([
          CondoStorage.listBlocks(pool, params.id_condo),
          CondoStorage.listUnits(pool, params.id_condo, { with_holder: ctx.isAdmin }),
          CondoStorage.listSpots(pool, params.id_condo, { with_holder: ctx.isAdmin }),
        ]);

        return {
          blocks,
          units,
          parking,
          viewer: {
            is_admin: ctx.isAdmin,
            is_resident: ctx.resident.confirmed,
            has_pending_claim: ctx.resident.pending,
            units: ctx.resident.units,
            parking: ctx.resident.parking,
          },
        };
      }
    );
  }

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

        const name = clean(body?.name, MAX_BLOCK_NAME);
        if (!name) return { error: "Informe o nome do bloco.", statusCode: 400 };

        const block = await CondoStorage.createBlock(pool, params.id_condo, name);
        return { block };
      }
    );
  }

  static async deleteBlock(user, params) {
    return runWithLogs(
      log,
      "deleteBlock",
      () => ({ id_user: user?.id_user, id_block: params?.id_block }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "admin",
        });
        if (ctx.error) return ctx;
        const ok = await CondoStorage.deleteBlock(pool, params.id_condo, params.id_block);
        return { ok };
      }
    );
  }

  // Cadastro antecipado de unidade pela administração (opcional: a unidade
  // também nasce sozinha quando alguém a reivindica).
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

        const number = clean(body?.number, MAX_UNIT_NUMBER);
        if (!number) return { error: "Informe o número do apartamento.", statusCode: 400 };
        const id_block = body?.id_block ? Number(body.id_block) : null;

        const unit = await CondoStorage.createUnit(pool, params.id_condo, {
          id_block,
          number,
        });
        return { unit };
      }
    );
  }

  static async createSpot(user, params, body) {
    return runWithLogs(
      log,
      "createSpot",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "admin",
        });
        if (ctx.error) return ctx;

        const code = clean(body?.code, MAX_SPOT_CODE);
        if (!code) return { error: "Informe o número/código da vaga.", statusCode: 400 };
        const id_unit = body?.id_unit ? Number(body.id_unit) : null;

        const spot = await CondoStorage.createSpot(pool, params.id_condo, { code, id_unit });
        return { spot };
      }
    );
  }

  // Endereço só é editável pela administração (dado sensível).
  static async updateAddress(user, params, body) {
    return runWithLogs(
      log,
      "updateAddress",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "admin",
        });
        if (ctx.error) return ctx;

        const address = CondoRules.normalizeAddress(body?.address || body);
        const updated = await CommunityStorage.updateCondoAddress(
          pool,
          params.id_condo,
          address
        );
        if (!updated) return { error: "Não foi possível salvar o endereço." };
        return { address: CondoRules.fullAddress(updated) };
      }
    );
  }

  /* ---------------------------- reivindicações --------------------------- */

  // O morador informa bloco + apartamento. Livre → aprovado na hora. Ocupado
  // por OUTRA pessoa → pendente, decisão da administração. A unidade é criada
  // se ainda não existir (o síndico não precisa cadastrar a planta inteira).
  static async claimUnit(user, params, body) {
    return runWithLogs(
      log,
      "claimUnit",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };

        const number = clean(body?.number, MAX_UNIT_NUMBER);
        if (!number) return { error: "Informe o número do apartamento.", statusCode: 400 };
        const blockName = clean(body?.block_name, MAX_BLOCK_NAME);
        const note = clean(body?.note, 280);

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const condo = await CondoStorage.getCondo(client, params.id_condo);
          if (!condo) {
            await client.query("ROLLBACK");
            return { error: "Condomínio não encontrado", statusCode: 404 };
          }

          // Reivindicar é o ato de entrar: quem ainda não é membro vira membro
          // aqui (sem teto — condomínio não consome ingresso, mig 196).
          await CommunityStorage.addMember(client, params.id_condo, id_user, "member");

          let id_block = body?.id_block ? Number(body.id_block) : null;
          if (!id_block && blockName) {
            const block = await CondoStorage.createBlock(client, params.id_condo, blockName);
            id_block = block?.id_block ?? null;
          }

          const unit = await CondoStorage.createUnit(client, params.id_condo, {
            id_block,
            number,
          });
          if (!unit) {
            await client.query("ROLLBACK");
            return { error: "Não foi possível registrar a unidade." };
          }

          if (String(unit.id_holder_user || "") === String(id_user)) {
            await client.query("COMMIT");
            return { ok: true, status: "approved", already: true, id_unit: unit.id_unit };
          }

          const free = !unit.id_holder_user;
          const dup = await CondoStorage.getPendingClaim(client, {
            id_user,
            id_unit: unit.id_unit,
          });
          if (dup && !free) {
            await client.query("COMMIT");
            return { ok: true, status: "pending", id_claim: dup.id_claim, duplicated: true };
          }

          const claim = await CondoStorage.createClaim(client, {
            id_condo: params.id_condo,
            id_user,
            target_type: "unit",
            id_unit: unit.id_unit,
            status: free ? "approved" : "pending",
            note,
          });

          if (free) {
            await CondoStorage.setUnitHolder(client, unit.id_unit, id_user);
          }

          await client.query("COMMIT");

          if (!free) {
            const label = CondoRules.unitLabel({
              block_name: blockName,
              number,
            });
            const admins = await this._adminUserIds(pool, params.id_condo);
            for (const admin of admins) {
              NotificationService.notifyCondoClaimPending({
                admin_user_id: admin,
                claimant_user_id: id_user,
                id_condo: params.id_condo,
                id_claim: claim.id_claim,
                target_label: label,
                condo_name: condo.display_name,
              }).catch(() => {});
            }
          }

          return {
            ok: true,
            status: free ? "approved" : "pending",
            id_unit: unit.id_unit,
            id_claim: claim.id_claim,
          };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* conexão pode estar inutilizável */
          }
          log.error("claimUnit.fail", { id_user, error: err.message });
          return { error: "Não foi possível reivindicar a unidade." };
        } finally {
          client.release();
        }
      }
    );
  }

  // Vaga segue a MESMA validação da unidade — inclusive a fila pendente. Só
  // morador confirmado pede vaga: a vaga é vinculada à ocupação.
  static async claimParking(user, params, body) {
    return runWithLogs(
      log,
      "claimParking",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado" };

        const code = clean(body?.code, MAX_SPOT_CODE);
        if (!code) return { error: "Informe o número/código da vaga.", statusCode: 400 };
        const note = clean(body?.note, 280);

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const condo = await CondoStorage.getCondo(client, params.id_condo);
          if (!condo) {
            await client.query("ROLLBACK");
            return { error: "Condomínio não encontrado", statusCode: 404 };
          }

          const resident = await CondoStorage.getResidentStatus(
            client,
            params.id_condo,
            id_user
          );
          if (!resident.confirmed) {
            await client.query("ROLLBACK");
            return {
              error: "Confirme seu apartamento antes de cadastrar uma vaga.",
              statusCode: 403,
              needs_claim: true,
            };
          }

          // A vaga entra vinculada à unidade do morador (a primeira, quando
          // ele tem mais de uma, ou a que ele indicar).
          const id_unit = body?.id_unit
            ? Number(body.id_unit)
            : resident.units[0]?.id_unit ?? null;

          const spot = await CondoStorage.createSpot(client, params.id_condo, {
            code,
            id_unit,
          });
          if (!spot) {
            await client.query("ROLLBACK");
            return { error: "Não foi possível registrar a vaga." };
          }

          if (String(spot.id_holder_user || "") === String(id_user)) {
            await client.query("COMMIT");
            return { ok: true, status: "approved", already: true, id_spot: spot.id_spot };
          }

          const free = !spot.id_holder_user;
          const dup = await CondoStorage.getPendingClaim(client, {
            id_user,
            id_spot: spot.id_spot,
          });
          if (dup && !free) {
            await client.query("COMMIT");
            return { ok: true, status: "pending", id_claim: dup.id_claim, duplicated: true };
          }

          const claim = await CondoStorage.createClaim(client, {
            id_condo: params.id_condo,
            id_user,
            target_type: "parking",
            id_spot: spot.id_spot,
            status: free ? "approved" : "pending",
            note,
          });

          if (free) {
            await CondoStorage.setSpotHolder(client, spot.id_spot, id_user, id_unit);
          }

          await client.query("COMMIT");

          if (!free) {
            const admins = await this._adminUserIds(pool, params.id_condo);
            for (const admin of admins) {
              NotificationService.notifyCondoClaimPending({
                admin_user_id: admin,
                claimant_user_id: id_user,
                id_condo: params.id_condo,
                id_claim: claim.id_claim,
                target_label: `Vaga ${code}`,
                condo_name: condo.display_name,
              }).catch(() => {});
            }
          }

          return {
            ok: true,
            status: free ? "approved" : "pending",
            id_spot: spot.id_spot,
            id_claim: claim.id_claim,
          };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* noop */
          }
          log.error("claimParking.fail", { id_user, error: err.message });
          return { error: "Não foi possível reivindicar a vaga." };
        } finally {
          client.release();
        }
      }
    );
  }

  static async listClaims(user, params, query) {
    return runWithLogs(
      log,
      "listClaims",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "admin",
        });
        if (ctx.error) return ctx;
        const claims = await CondoStorage.listClaims(pool, params.id_condo, {
          status: query?.status || "pending",
        });
        return { claims };
      }
    );
  }

  static async listMyClaims(user, params) {
    return runWithLogs(
      log,
      "listMyClaims",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const claims = await CondoStorage.listClaimsForUser(
          pool,
          params.id_condo,
          user.id_user
        );
        return { claims };
      }
    );
  }

  // Aprovar TRANSFERE a titularidade (o morador antigo perde a unidade) e
  // arquiva as outras pendências do mesmo alvo.
  static async decideClaim(user, params, body) {
    return runWithLogs(
      log,
      "decideClaim",
      () => ({ id_user: user?.id_user, id_claim: params?.id_claim, action: body?.action }),
      async () => {
        const action = body?.action === "approve" ? "approved" : body?.action === "reject" ? "rejected" : null;
        if (!action) return { error: "Ação inválida (approve|reject).", statusCode: 400 };

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const ctx = await this._context(client, user?.id_user, params?.id_condo, {
            require: "admin",
          });
          if (ctx.error) {
            await client.query("ROLLBACK");
            return ctx;
          }

          const claim = await CondoStorage.getClaim(client, params.id_condo, params.id_claim);
          if (!claim) {
            await client.query("ROLLBACK");
            return { error: "Reivindicação não encontrada", statusCode: 404 };
          }
          if (claim.status !== "pending") {
            await client.query("ROLLBACK");
            return { error: "Esta reivindicação já foi decidida.", statusCode: 409 };
          }

          const resolved = await CondoStorage.resolveClaim(client, params.id_claim, {
            status: action,
            decided_by: user.id_user,
          });
          if (!resolved) {
            await client.query("ROLLBACK");
            return { error: "Esta reivindicação já foi decidida.", statusCode: 409 };
          }

          let losers = [];
          if (action === "approved") {
            if (claim.target_type === "unit") {
              await CondoStorage.setUnitHolder(client, claim.id_unit, claim.id_user);
            } else {
              await CondoStorage.setSpotHolder(client, claim.id_spot, claim.id_user, null);
            }
            losers = await CondoStorage.rejectOtherPendingForTarget(client, {
              id_claim: Number(params.id_claim),
              id_unit: claim.id_unit,
              id_spot: claim.id_spot,
            });
          }

          await client.query("COMMIT");

          const label =
            claim.target_type === "unit"
              ? CondoRules.unitLabel({ block_name: claim.block_name, number: claim.unit_number })
              : `Vaga ${claim.spot_code}`;

          NotificationService.notifyCondoClaimResolved({
            claimant_user_id: claim.id_user,
            admin_user_id: user.id_user,
            id_condo: params.id_condo,
            id_claim: claim.id_claim,
            status: action,
            target_label: label,
            condo_name: ctx.condo.display_name,
          }).catch(() => {});

          for (const loser of losers) {
            NotificationService.notifyCondoClaimResolved({
              claimant_user_id: loser.id_user,
              admin_user_id: user.id_user,
              id_condo: params.id_condo,
              id_claim: loser.id_claim,
              status: "rejected",
              target_label: label,
              condo_name: ctx.condo.display_name,
            }).catch(() => {});
          }

          return { ok: true, status: action };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* noop */
          }
          log.error("decideClaim.fail", { id_user: user?.id_user, error: err.message });
          return { error: "Não foi possível decidir a reivindicação." };
        } finally {
          client.release();
        }
      }
    );
  }

  // Morador devolve a unidade/vaga (mudou de prédio). Administração também
  // pode liberar pelo mesmo caminho.
  static async release(user, params, body) {
    return runWithLogs(
      log,
      "release",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const ctx = await this._context(pool, user?.id_user, params?.id_condo, {
          require: "member",
        });
        if (ctx.error) return ctx;

        const id_unit = body?.id_unit ? Number(body.id_unit) : null;
        const id_spot = body?.id_spot ? Number(body.id_spot) : null;
        if (!id_unit && !id_spot) {
          return { error: "Informe a unidade ou a vaga.", statusCode: 400 };
        }

        if (id_unit) {
          const unit = await CondoStorage.getUnit(pool, params.id_condo, id_unit);
          if (!unit) return { error: "Unidade não encontrada", statusCode: 404 };
          if (!ctx.isAdmin && String(unit.id_holder_user || "") !== String(user.id_user)) {
            return { error: "Esta unidade não é sua.", statusCode: 403 };
          }
          await CondoStorage.setUnitHolder(pool, id_unit, null);
          return { ok: true };
        }

        const spot = await CondoStorage.getSpot(pool, params.id_condo, id_spot);
        if (!spot) return { error: "Vaga não encontrada", statusCode: 404 };
        if (!ctx.isAdmin && String(spot.id_holder_user || "") !== String(user.id_user)) {
          return { error: "Esta vaga não é sua.", statusCode: 403 };
        }
        await CondoStorage.setSpotHolder(pool, id_spot, null, null);
        return { ok: true };
      }
    );
  }
}

module.exports = CondoService;
