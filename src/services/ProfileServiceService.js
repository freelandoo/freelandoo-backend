const pool = require("../databases");
const ProfileServiceStorage = require("../storages/ProfileServiceStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const ClanStorage = require("../storages/ClanStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProfileServiceService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function assertOwnerWithProfile(conn, id_profile, id_user) {
  const profile = await ProfileStorage.getProfileById(conn, id_profile);
  if (!profile) return { error: "Perfil não encontrado" };
  if (String(profile.id_user) !== String(id_user)) return { error: "Sem permissão para alterar este perfil" };
  return { profile };
}

function validateInput(payload, { partial = false } = {}) {
  const out = {};
  if (!partial || Object.prototype.hasOwnProperty.call(payload, "name")) {
    if (typeof payload.name !== "string" || payload.name.trim().length === 0) return { error: "Nome do serviço é obrigatório" };
    out.name = payload.name.trim().slice(0, 160);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "description")) {
    if (payload.description !== null && typeof payload.description !== "string") return { error: "Descrição inválida" };
    out.description = payload.description ? payload.description.trim() : null;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(payload, "duration_minutes")) {
    const d = Number(payload.duration_minutes);
    if (!Number.isInteger(d) || d <= 0) return { error: "Duração inválida (em minutos, > 0)" };
    out.duration_minutes = d;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(payload, "price_amount")) {
    const p = Number(payload.price_amount);
    if (!Number.isInteger(p) || p < 0) return { error: "Valor inválido (em centavos, >= 0)" };
    out.price_amount = p;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "is_active")) {
    if (typeof payload.is_active !== "boolean") return { error: "is_active inválido" };
    out.is_active = payload.is_active;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "member_profile_ids")) {
    const arr = payload.member_profile_ids;
    if (!Array.isArray(arr)) return { error: "member_profile_ids deve ser array" };
    const seen = new Set();
    for (const id of arr) {
      if (typeof id !== "string" || !UUID_RE.test(id)) return { error: "member_profile_ids contém id inválido" };
      seen.add(id);
    }
    out.member_profile_ids = [...seen];
  }
  return { data: out };
}

async function validateClanMembers(conn, id_clan_profile, member_profile_ids) {
  if (member_profile_ids.length === 0) return null;
  const members = await ClanStorage.listMembers(conn, id_clan_profile);
  const validIds = new Set(members.map((m) => String(m.id_member_profile)));
  for (const id of member_profile_ids) {
    if (!validIds.has(String(id))) return { error: "Membro não pertence ao clan" };
  }
  return null;
}

function enrichService(service, memberIds) {
  return { ...service, member_profile_ids: memberIds || [] };
}

class ProfileServiceService {
  static async list(user, params) {
    return runWithLogs(log, "list", () => ({ id_user: user?.id_user, id_profile: params?.id_profile }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { id_profile } = params;
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      const own = await assertOwnerWithProfile(pool, id_profile, user.id_user);
      if (own.error) return { error: own.error };
      const services = await ProfileServiceStorage.list(pool, id_profile);
      const ids = services.map((s) => Number(s.id_profile_service));
      const memberMap = own.profile.is_clan
        ? await ProfileServiceStorage.getMemberIdsByServices(pool, ids)
        : new Map();
      return { services: services.map((s) => enrichService(s, memberMap.get(String(s.id_profile_service)) || [])) };
    });
  }

  static async create(user, params, body) {
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user, id_profile: params?.id_profile }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { id_profile } = params;
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      const v = validateInput(body || {});
      if (v.error) return { error: v.error };
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const own = await assertOwnerWithProfile(client, id_profile, user.id_user);
        if (own.error) { await client.query("ROLLBACK"); return { error: own.error }; }
        const memberIds = own.profile.is_clan ? (v.data.member_profile_ids || []) : [];
        if (own.profile.is_clan) {
          const memErr = await validateClanMembers(client, id_profile, memberIds);
          if (memErr) { await client.query("ROLLBACK"); return memErr; }
        }
        const { member_profile_ids: _ignore, ...serviceFields } = v.data;
        const service = await ProfileServiceStorage.create(client, { id_profile, ...serviceFields });
        if (own.profile.is_clan) {
          await ProfileServiceStorage.setMembers(client, service.id_profile_service, memberIds);
        }
        await client.query("COMMIT");
        return { service: enrichService(service, memberIds) };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally { client.release(); }
    });
  }

  static async update(user, params, body) {
    return runWithLogs(log, "update", () => ({ id_user: user?.id_user, id_profile: params?.id_profile, id_profile_service: params?.id_profile_service }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { id_profile, id_profile_service } = params;
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      if (!id_profile_service || isNaN(Number(id_profile_service))) return { error: "id_profile_service inválido" };
      const v = validateInput(body || {}, { partial: true });
      if (v.error) return { error: v.error };
      if (Object.keys(v.data).length === 0) return { error: "Nenhum campo para atualizar" };
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const own = await assertOwnerWithProfile(client, id_profile, user.id_user);
        if (own.error) { await client.query("ROLLBACK"); return { error: own.error }; }
        const existing = await ProfileServiceStorage.getById(client, Number(id_profile_service));
        if (!existing || String(existing.id_profile) !== String(id_profile)) {
          await client.query("ROLLBACK");
          return { error: "Serviço não encontrado" };
        }
        const hasMemberUpdate = Object.prototype.hasOwnProperty.call(v.data, "member_profile_ids");
        const memberIdsInput = hasMemberUpdate ? (v.data.member_profile_ids || []) : null;
        if (own.profile.is_clan && memberIdsInput) {
          const memErr = await validateClanMembers(client, id_profile, memberIdsInput);
          if (memErr) { await client.query("ROLLBACK"); return memErr; }
        }
        const { member_profile_ids: _ignore, ...serviceFields } = v.data;
        let service = existing;
        if (Object.keys(serviceFields).length > 0) {
          service = await ProfileServiceStorage.update(client, Number(id_profile_service), serviceFields);
        }
        if (own.profile.is_clan && hasMemberUpdate) {
          await ProfileServiceStorage.setMembers(client, Number(id_profile_service), memberIdsInput);
        }
        const finalMembers = own.profile.is_clan
          ? await ProfileServiceStorage.getMemberIds(client, Number(id_profile_service))
          : [];
        await client.query("COMMIT");
        return { service: enrichService(service, finalMembers) };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally { client.release(); }
    });
  }

  static async remove(user, params) {
    return runWithLogs(log, "remove", () => ({ id_user: user?.id_user, id_profile: params?.id_profile, id_profile_service: params?.id_profile_service }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { id_profile, id_profile_service } = params;
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      if (!id_profile_service || isNaN(Number(id_profile_service))) return { error: "id_profile_service inválido" };
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const own = await assertOwnerWithProfile(client, id_profile, user.id_user);
        if (own.error) { await client.query("ROLLBACK"); return { error: own.error }; }
        const existing = await ProfileServiceStorage.getById(client, Number(id_profile_service));
        if (!existing || String(existing.id_profile) !== String(id_profile)) {
          await client.query("ROLLBACK");
          return { error: "Serviço não encontrado" };
        }
        await ProfileServiceStorage.softDelete(client, Number(id_profile_service));
        await client.query("COMMIT");
        return { message: "Serviço removido" };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally { client.release(); }
    });
  }

  // Público — somente serviços ativos
  static async listPublic(id_profile) {
    return runWithLogs(log, "listPublic", () => ({ id_profile }), async () => {
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      const profile = await ProfileStorage.getProfileById(pool, id_profile);
      if (!profile) return { error: "Perfil não encontrado" };
      const services = await ProfileServiceStorage.list(pool, id_profile, { only_active: true });
      const ids = services.map((s) => Number(s.id_profile_service));
      const memberMap = profile.is_clan
        ? await ProfileServiceStorage.getMemberIdsByServices(pool, ids)
        : new Map();
      return { services: services.map((s) => enrichService(s, memberMap.get(String(s.id_profile_service)) || [])) };
    });
  }
}

module.exports = ProfileServiceService;
