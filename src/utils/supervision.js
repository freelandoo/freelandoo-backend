/**
 * supervision.js — guards e helpers de Conta Supervisionada.
 *
 * Convenção: helpers que retornam booleano não lançam. Helpers `assertNot*`
 * retornam `null` (ok) ou `{ error, status }` (bloqueio) para encaixar no
 * padrão `sendServiceResult` dos services.
 */

const pool = require("../databases");
const SupervisionStorage = require("../storages/SupervisionStorage");

function isAdultBirthdate(date) {
  if (!date) return true; // sem data → assume adulto (compat. com users antigos)
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return true;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age >= 18;
}

async function isMinorUser(userId, conn = pool) {
  if (!userId) return false;
  const u = await SupervisionStorage.getUserMinorFlags(conn, userId);
  return Boolean(u && u.is_minor);
}

/**
 * Retorna o estado de supervisão do usuário: minoridade + status do vínculo.
 * - `is_minor`: flag denormalizada em tb_user.
 * - `link_status`: status atual do supervised_account ('active'|'suspended'|
 *   'revoked'|null se não tiver vínculo).
 * - `responsible_user_id`: dono do vínculo (do tb_user denormalizado).
 */
async function getSupervisionState(userId, conn = pool) {
  if (!userId) return { is_minor: false, link_status: null, responsible_user_id: null };
  const flags = await SupervisionStorage.getUserMinorFlags(conn, userId);
  if (!flags?.is_minor) {
    return { is_minor: false, link_status: null, responsible_user_id: null };
  }
  const link = await SupervisionStorage.getSupervisedByMinor(conn, userId);
  return {
    is_minor: true,
    link_status: link?.status || null,
    responsible_user_id: flags.responsible_user_id || null,
  };
}

async function getResponsibleUser(minorUserId, conn = pool) {
  if (!minorUserId) return null;
  const u = await SupervisionStorage.getUserMinorFlags(conn, minorUserId);
  return u?.responsible_user_id || null;
}

async function hasMinorPermission(minorUserId, permission, conn = pool) {
  if (!SupervisionStorage.PERMISSION_KEYS.includes(permission)) return false;
  const perms = await SupervisionStorage.getPermissions(conn, minorUserId);
  if (!perms) return false;
  return perms[permission] === true;
}

async function canAccessMachine(minorUserId, idMachine, conn = pool) {
  if (!idMachine) return false;
  return SupervisionStorage.isMachineAllowedForMinor(
    conn,
    minorUserId,
    idMachine
  );
}

// Helper interno: bloqueio quando vínculo está suspended/revoked.
// Retorna null se a conta está livre para agir, ou { error, status } se está
// supervisionada e o vínculo não é 'active'.
async function assertLinkActiveIfMinor(userId, conn = pool) {
  const state = await getSupervisionState(userId, conn);
  if (!state.is_minor) return null;
  if (state.link_status === "suspended") {
    return {
      error: "Conta supervisionada está suspensa pelo responsável",
      status: 403,
    };
  }
  if (state.link_status === "revoked") {
    return {
      error: "Vínculo de supervisão foi revogado",
      status: 403,
    };
  }
  return null;
}

// Bloqueios duros: ficam negados independente do toggle de permissão.
async function assertNotMinorForServiceRequest(userId, conn = pool) {
  if (await isMinorUser(userId, conn)) {
    return {
      error: "Contas supervisionadas não podem solicitar serviços",
      status: 403,
    };
  }
  return null;
}

async function assertNotMinorForShowcase(userId, conn = pool) {
  if (await isMinorUser(userId, conn)) {
    return {
      error: "Contas supervisionadas não aparecem na vitrine",
      status: 403,
    };
  }
  return null;
}

async function assertNotMinorForRanking(userId, conn = pool) {
  if (await isMinorUser(userId, conn)) {
    return {
      error: "Contas supervisionadas não aparecem em rankings",
      status: 403,
    };
  }
  return null;
}

async function assertNotMinorForMural(userId, conn = pool) {
  if (await isMinorUser(userId, conn)) {
    return {
      error: "Contas supervisionadas não possuem mural público",
      status: 403,
    };
  }
  return null;
}

// Soft: depende de toggle. Ex.: cursos/feed/chats.
async function assertMinorPermission(userId, permission, conn = pool) {
  const state = await getSupervisionState(userId, conn);
  if (!state.is_minor) return null;
  // Vínculo suspended/revoked bloqueia tudo, antes do toggle.
  if (state.link_status !== "active") {
    return {
      error:
        state.link_status === "suspended"
          ? "Conta supervisionada está suspensa pelo responsável"
          : "Vínculo de supervisão foi revogado",
      status: 403,
    };
  }
  const ok = await hasMinorPermission(userId, permission, conn);
  if (!ok) {
    return {
      error: `Ação bloqueada pelo responsável (${permission})`,
      status: 403,
    };
  }
  return null;
}

async function assertMachineAllowed(userId, idMachine, conn = pool) {
  const state = await getSupervisionState(userId, conn);
  if (!state.is_minor) return null;
  if (state.link_status !== "active") {
    return {
      error:
        state.link_status === "suspended"
          ? "Conta supervisionada está suspensa pelo responsável"
          : "Vínculo de supervisão foi revogado",
      status: 403,
    };
  }
  const ok = await canAccessMachine(userId, idMachine, conn);
  if (!ok) {
    return {
      error: "Esta máquina não está liberada pelo responsável",
      status: 403,
    };
  }
  return null;
}

module.exports = {
  isAdultBirthdate,
  isMinorUser,
  getResponsibleUser,
  getSupervisionState,
  hasMinorPermission,
  canAccessMachine,
  assertLinkActiveIfMinor,
  assertNotMinorForServiceRequest,
  assertNotMinorForShowcase,
  assertNotMinorForRanking,
  assertNotMinorForMural,
  assertMinorPermission,
  assertMachineAllowed,
};
