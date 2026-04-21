// src/services/user/UpdateMeService.js
const UserStorage = require("../../storages/UserStorage");
const AuthStorage = require("../../storages/AuthStorage");
const { validateUsername } = require("../../utils/validateUsername");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("UpdateMeService");

module.exports = class UpdateMeService {
  static async execute({ db, id_user, patch }) {
    return runWithLogs(
      log,
      "execute",
      () => ({ id_user, keys: patch ? Object.keys(patch) : [] }),
      async () => {
        // Validate username if being updated
        if (patch && patch.username !== undefined) {
          const v = validateUsername(patch.username);
          if (!v.ok) {
            const err = new Error("Nome de usuário inválido: " + v.error);
            err.statusCode = 400;
            throw err;
          }
          patch.username = v.username;

          const existingId = await AuthStorage.findUserIdByUsername(db, v.username);
          if (existingId && existingId !== id_user) {
            const err = new Error("Este nome de usuário já está em uso");
            err.statusCode = 409;
            throw err;
          }
        }

        const updated = await UserStorage.updateUserById(db, id_user, patch);

        if (!updated) {
          const err = new Error("Nenhum campo para atualizar");
          err.statusCode = 400;
          throw err;
        }

        return updated;
      }
    );
  }
};
