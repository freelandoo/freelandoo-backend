const ProfileStorage = require("../../storages/ProfileStorage");
const uploadProfileAvatarToR2 = require("../../integrations/r2/uploadProfileAvatar");
const { createLogger } = require("../../utils/logger");

const log = createLogger("UploadProfileAvatarService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = class UploadProfileAvatarService {
  static async execute({ db, id_user, params, file }) {
    log.info("execute.start", { id_user, id_profile: params?.id_profile });

    const { id_profile } = params;

    if (!id_user) {
      const err = new Error("Não autenticado");
      err.statusCode = 401;
      throw err;
    }

    if (!id_profile || !UUID_RE.test(id_profile)) {
      const err = new Error("id_profile inválido");
      err.statusCode = 400;
      throw err;
    }

    if (!file) {
      const err = new Error("Arquivo não enviado");
      err.statusCode = 400;
      throw err;
    }

    const client = await db.connect();
    try {
      const profile = await ProfileStorage.getProfileById(client, id_profile);
      if (!profile) {
        const err = new Error("Perfil não encontrado");
        err.statusCode = 404;
        throw err;
      }
      if (String(profile.id_user) !== String(id_user)) {
        const err = new Error("Você não tem permissão para alterar este perfil");
        err.statusCode = 403;
        throw err;
      }

      const avatar_url = await uploadProfileAvatarToR2({ id_profile, file });
      const updated = await ProfileStorage.updateProfile(client, id_profile, { avatar_url });

      log.info("execute.ok", { id_profile, avatar_url });
      return { avatar_url: updated.avatar_url };
    } finally {
      client.release();
    }
  }
};
