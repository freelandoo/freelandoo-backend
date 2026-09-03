// src/services/user/UpdateAvatarService.js
const ProfileStorage = require("../../storages/ProfileStorage");
const uploadAvatarToR2 = require("../../integrations/r2/uploadAvatar");
const { createLogger, runWithLogs } = require("../../utils/logger");
const { processAvatarImage } = require("../../utils/mediaProcessing");

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

        const processedFile = await processAvatarImage(file);
        const avatarUrl = await uploadAvatarToR2({ id_user, file: processedFile });

        // O badge de câmera do /account edita a foto de UM perfil — o que hoje
        // carrega o rosto da pessoa — e não uma foto de "usuário" à parte. Por
        // isso passa pelo MESMO `setAvatar` do headcard: enquanto eram dois
        // caminhos, cada um gravava numa tabela e as telas discordavam.
        const id_profile = await ProfileStorage.getUserAccountProfileId(db, id_user);
        const updated = await ProfileStorage.setAvatar(db, id_profile, avatarUrl);

        return { id_user, avatar: updated?.avatar_url ?? avatarUrl };
      }
    );
  }
};
