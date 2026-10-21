// src/services/user/GetCreatorService.js
const UserStorage = require("../../storages/UserStorage");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("GetCreatorService");

module.exports = class GetCreatorService {
  static async execute({ db, id_user }) {
    return runWithLogs(
      log,
      "execute",
      () => ({ id_user }),
      async () => {
        const user = await UserStorage.getUserWithSocialById(db, id_user);
        // Conta vinda de academia aguardando aceite não tem perfil público (mig 296).
        if (!user || user.academy_onboarding_state === "aguardando_aceite") {
          const err = new Error("Usuário não encontrado");
          err.statusCode = 404;
          throw err;
        }
        return user;
      }
    );
  }
};
