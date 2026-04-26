const pool = require("../databases");
const ProfileServiceStorage = require("../storages/ProfileServiceStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProfileServiceService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function assertOwner(conn, id_profile, id_user) {
  const profile = await ProfileStorage.getProfileById(conn, id_profile);
  if (!profile) return { error: "Perfil não encontrado" };
  if (String(profile.id_user) !== String(id_user)) return { error: "Sem permissão para alterar este perfil" };
  return null;
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
  return { data: out };
}

class ProfileServiceService {
  static async list(user, params) {
    return runWithLogs(log, "list", () => ({ id_user: user?.id_user, id_profile: params?.id_profile }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { id_profile } = params;
      if (!id_profile || !UUID_RE.test(id_profile)) return { error: "id_profile inválido" };
      const ownErr = await assertOwner(pool, id_profile, user.id_user);
      if (ownErr) return ownErr;
      const services = await ProfileServiceStorage.list(pool, id_profile);
      return { services };
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
        const ownErr = await assertOwner(client, id_profile, user.id_user);
        if (ownErr) { await client.query("ROLLBACK"); return ownErr; }
        const service = await ProfileServiceStorage.create(client, { id_profile, ...v.data });
        await client.query("COMMIT");
        return { service };
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
        const ownErr = await assertOwner(client, id_profile, user.id_user);
        if (ownErr) { await client.query("ROLLBACK"); return ownErr; }
        const existing = await ProfileServiceStorage.getById(client, Number(id_profile_service));
        if (!existing || String(existing.id_profile) !== String(id_profile)) {
          await client.query("ROLLBACK");
          return { error: "Serviço não encontrado" };
        }
        const service = await ProfileServiceStorage.update(client, Number(id_profile_service), v.data);
        await client.query("COMMIT");
        return { service };
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
        const ownErr = await assertOwner(client, id_profile, user.id_user);
        if (ownErr) { await client.query("ROLLBACK"); return ownErr; }
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
      const services = await ProfileServiceStorage.list(pool, id_profile, { only_active: true });
      return { services };
    });
  }
}

module.exports = ProfileServiceService;
