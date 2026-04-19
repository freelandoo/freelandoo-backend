const RolesStorage = require("../storages/RolesStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("RolesService");

function isUuid(v) {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v
    )
  );
}

class RolesService {
  static async list({ active }) {
    return runWithLogs(
      log,
      "list",
      () => ({ active }),
      async () => RolesStorage.list({ active })
    );
  }

  static async getById(id_role) {
    return runWithLogs(
      log,
      "getById",
      () => ({ id_role }),
      async () => {
        if (!isUuid(id_role)) {
          const err = new Error("id_role inválido");
          err.statusCode = 400;
          throw err;
        }

        const role = await RolesStorage.getById(id_role);
        if (!role) {
          const err = new Error("Role não encontrada");
          err.statusCode = 404;
          throw err;
        }

        return role;
      }
    );
  }

  static async create({ desc_role, created_by }) {
    return runWithLogs(
      log,
      "create",
      () => ({ created_by }),
      async () => {
        if (!desc_role || typeof desc_role !== "string" || !desc_role.trim()) {
          const err = new Error("desc_role é obrigatório");
          err.statusCode = 400;
          throw err;
        }

        const clean = desc_role.trim();

        const exists = await RolesStorage.getByDesc(clean);
        if (exists) {
          const err = new Error("Role já existe");
          err.statusCode = 409;
          throw err;
        }

        return RolesStorage.create({ desc_role: clean, created_by });
      }
    );
  }

  static async update({ id_role, desc_role, is_active, updated_by }) {
    return runWithLogs(
      log,
      "update",
      () => ({ id_role, updated_by }),
      async () => {
        if (!isUuid(id_role)) {
          const err = new Error("id_role inválido");
          err.statusCode = 400;
          throw err;
        }

        if (desc_role === undefined && is_active === undefined) {
          const err = new Error("Nada para atualizar");
          err.statusCode = 400;
          throw err;
        }

        let cleanDesc;
        if (desc_role !== undefined) {
          if (typeof desc_role !== "string" || !desc_role.trim()) {
            const err = new Error("desc_role inválido");
            err.statusCode = 400;
            throw err;
          }
          cleanDesc = desc_role.trim();

          const exists = await RolesStorage.getByDesc(cleanDesc);
          if (exists && exists.id_role !== id_role) {
            const err = new Error("Role já existe");
            err.statusCode = 409;
            throw err;
          }
        }

        if (is_active !== undefined && typeof is_active !== "boolean") {
          const err = new Error("is_active deve ser boolean");
          err.statusCode = 400;
          throw err;
        }

        const updated = await RolesStorage.update({
          id_role,
          desc_role: cleanDesc,
          is_active,
          updated_by,
        });

        if (!updated) {
          const err = new Error("Role não encontrada");
          err.statusCode = 404;
          throw err;
        }

        return updated;
      }
    );
  }

  static async remove({ id_role, updated_by }) {
    return runWithLogs(
      log,
      "remove",
      () => ({ id_role, updated_by }),
      async () => {
        if (!isUuid(id_role)) {
          const err = new Error("id_role inválido");
          err.statusCode = 400;
          throw err;
        }

        const deleted = await RolesStorage.softDelete({ id_role, updated_by });
        if (!deleted) {
          const err = new Error("Role não encontrada");
          err.statusCode = 404;
          throw err;
        }

        return deleted;
      }
    );
  }
}

module.exports = RolesService;
