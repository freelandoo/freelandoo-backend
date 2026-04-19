// src/services/user/UpdateAvatarService.js
const UserStorage = require("../../storages/UserStorage");
const uploadAvatarToR2 = require("../../integrations/r2/uploadAvatar");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("UpdateAvatarService");

module.exports = class UpdateAvatarService {
  static async execute({ db, id_user, file }) {
    return runWithLogs(
      log,
      "execute",
      () => ({ id_user, hasFile: !!file }),
      async () => {
        if (!file) {
          const err = new Error("Avatar não enviado");
          err.statusCode = 400;
          throw err;
        }

        const avatarUrl = await uploadAvatarToR2({ id_user, file });
        const updated = await UserStorage.updateAvatarById(
          db,
          id_user,
          avatarUrl
        );

        return updated;
      }
    );
  }
};
