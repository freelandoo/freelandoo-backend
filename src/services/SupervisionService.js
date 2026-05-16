/**
 * SupervisionService — orquestra a feature de Conta Supervisionada.
 *
 * - Geração/revogação/listagem de códigos do responsável.
 * - Validação pública do código (dry-run, sem efeitos).
 * - Consumo do código durante o signup (transacional, em consumeInviteForSignup).
 * - CRUD de menores vinculados, permissões e acesso a máquinas.
 */

const pool = require("../databases");
const SupervisionStorage = require("../storages/SupervisionStorage");
const { generateParentalCode } = require("../utils/parentalCode");
const { isAdultBirthdate } = require("../utils/supervision");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("SupervisionService");

const INVITE_TTL_HOURS = 24;
const MAX_INVITE_RETRIES = 5;

class SupervisionService {
  // -------------------------------------------------------------------------
  // Códigos do responsável
  // -------------------------------------------------------------------------

  static async generateInvite(user) {
    return runWithLogs(
      log,
      "generateInvite",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };

        const flags = await SupervisionStorage.getUserMinorFlags(
          pool,
          user.id_user
        );
        if (flags?.is_minor) {
          return {
            error: "Conta supervisionada não pode gerar códigos parentais",
          };
        }
        if (!isAdultBirthdate(flags?.data_nascimento)) {
          return {
            error: "Apenas usuários maiores de 18 anos podem gerar códigos",
          };
        }

        const expiresAt = new Date(
          Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000
        );

        for (let attempt = 0; attempt < MAX_INVITE_RETRIES; attempt++) {
          const code = generateParentalCode();
          try {
            const invite = await SupervisionStorage.createInvite(pool, {
              responsibleUserId: user.id_user,
              code,
              expiresAt,
            });
            return { invite };
          } catch (err) {
            // Colisão de código (UNIQUE) — tenta de novo
            if (err.code === "23505") continue;
            throw err;
          }
        }
        return { error: "Falha ao gerar código único, tente novamente" };
      }
    );
  }

  static async listInvites(user) {
    return runWithLogs(
      log,
      "listInvites",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const invites = await SupervisionStorage.listInvitesByResponsible(
          pool,
          user.id_user
        );
        return { invites };
      }
    );
  }

  static async revokeInvite(user, id_invite) {
    return runWithLogs(
      log,
      "revokeInvite",
      () => ({ id_user: user?.id_user, id_invite }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!id_invite) return { error: "id_invite é obrigatório" };
        const revoked = await SupervisionStorage.revokeInvite(pool, {
          id_invite,
          responsibleUserId: user.id_user,
        });
        if (!revoked) {
          return { error: "Código não encontrado ou já consumido" };
        }
        return { invite: revoked };
      }
    );
  }

  /**
   * Validação dry-run: usada pelo frontend de cadastro do menor para mostrar
   * "Código válido — responsável: @fulano" antes de submeter o formulário.
   */
  static async validateCode(payload) {
    return runWithLogs(
      log,
      "validateCode",
      () => ({ hasCode: !!payload?.code }),
      async () => {
        const code = String(payload?.code || "").trim().toUpperCase();
        if (!code) return { error: "Código é obrigatório" };

        const invite = await SupervisionStorage.getActiveInviteByCode(
          pool,
          code
        );
        if (!invite) {
          return { error: "Código inválido, expirado ou já utilizado" };
        }

        const responsible = await SupervisionStorage.getUserMinorFlags(
          pool,
          invite.responsible_user_id
        );
        if (!responsible || responsible.is_minor) {
          return { error: "Responsável inválido" };
        }
        if (!isAdultBirthdate(responsible.data_nascimento)) {
          return { error: "Responsável precisa ter 18 anos ou mais" };
        }

        return {
          valid: true,
          invite_id: invite.id_invite,
          expires_at: invite.expires_at,
        };
      }
    );
  }

  /**
   * Consome um código durante o signup do menor. Deve rodar dentro da mesma
   * transação do AuthService.signup (recebe `client` em uso).
   *
   * Retorna `{ ok: true, invite, supervised }` em caso de sucesso, ou
   * `{ error }` para abortar a transação.
   */
  static async consumeInviteForSignup(client, { code, minorUserId }) {
    const normalized = String(code || "").trim().toUpperCase();
    if (!normalized) return { error: "Código do responsável é obrigatório" };

    const invite = await SupervisionStorage.getActiveInviteByCode(
      client,
      normalized
    );
    if (!invite) {
      return { error: "Código inválido, expirado ou já utilizado" };
    }

    const responsible = await SupervisionStorage.getUserMinorFlags(
      client,
      invite.responsible_user_id
    );
    if (!responsible || responsible.is_minor) {
      return { error: "Responsável inválido" };
    }
    if (!isAdultBirthdate(responsible.data_nascimento)) {
      return { error: "Responsável precisa ter 18 anos ou mais" };
    }

    const used = await SupervisionStorage.markInviteUsed(client, {
      id_invite: invite.id_invite,
      usedByUserId: minorUserId,
    });
    if (!used) {
      // Race condition: outro signup consumiu enquanto isso.
      return { error: "Código já foi utilizado" };
    }

    const supervised = await SupervisionStorage.createSupervisedAccount(
      client,
      {
        minorUserId,
        responsibleUserId: invite.responsible_user_id,
        inviteId: invite.id_invite,
      }
    );

    await SupervisionStorage.markUserAsMinor(client, {
      userId: minorUserId,
      responsibleUserId: invite.responsible_user_id,
    });

    await SupervisionStorage.createDefaultPermissions(client, minorUserId);

    return { ok: true, invite: used, supervised };
  }

  // -------------------------------------------------------------------------
  // Painel do responsável: menores vinculados
  // -------------------------------------------------------------------------

  static async listMinors(user) {
    return runWithLogs(
      log,
      "listMinors",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const minors = await SupervisionStorage.listMinorsByResponsible(
          pool,
          user.id_user
        );
        // Anexa permissions + máquinas para evitar N requests do frontend.
        for (const m of minors) {
          m.permissions = await SupervisionStorage.getPermissions(
            pool,
            m.minor_user_id
          );
          m.machines = await SupervisionStorage.listMinorMachineAccess(
            pool,
            m.minor_user_id
          );
        }
        return { minors };
      }
    );
  }

  static async assertOwnsMinor(responsibleUserId, minorUserId) {
    const link = await SupervisionStorage.getSupervisedByMinor(
      pool,
      minorUserId
    );
    if (!link || link.responsible_user_id !== responsibleUserId) {
      return { error: "Menor não vinculado à sua conta", status: 403 };
    }
    if (link.status !== "active") {
      return { error: "Vínculo não está ativo" };
    }
    return null;
  }

  static async updateMinorPermissions(user, minorUserId, patch) {
    return runWithLogs(
      log,
      "updateMinorPermissions",
      () => ({ id_user: user?.id_user, minorUserId }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const guard = await SupervisionService.assertOwnsMinor(
          user.id_user,
          minorUserId
        );
        if (guard) return guard;
        const updated = await SupervisionStorage.updatePermissions(
          pool,
          minorUserId,
          patch || {}
        );
        return { permissions: updated };
      }
    );
  }

  static async setMinorStatus(user, minorUserId, status) {
    return runWithLogs(
      log,
      "setMinorStatus",
      () => ({ id_user: user?.id_user, minorUserId, status }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        if (!["active", "suspended", "revoked"].includes(status)) {
          return { error: "Status inválido" };
        }
        const updated = await SupervisionStorage.setSupervisedStatusByMinor(
          pool,
          {
            minorUserId,
            responsibleUserId: user.id_user,
            status,
          }
        );
        if (!updated) return { error: "Vínculo não encontrado" };
        return { supervised: updated };
      }
    );
  }

  static async setMinorMachine(user, minorUserId, idMachine, allowed) {
    return runWithLogs(
      log,
      "setMinorMachine",
      () => ({
        id_user: user?.id_user,
        minorUserId,
        idMachine,
        allowed,
      }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const guard = await SupervisionService.assertOwnsMinor(
          user.id_user,
          minorUserId
        );
        if (guard) return guard;
        const row = await SupervisionStorage.setMinorMachineAccess(pool, {
          minorUserId,
          idMachine,
          allowed,
        });
        return { access: row };
      }
    );
  }
}

module.exports = SupervisionService;
