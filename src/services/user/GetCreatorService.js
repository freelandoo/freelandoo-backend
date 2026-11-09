// src/services/user/GetCreatorService.js
//
// GET /users/:id — rota PÚBLICA (sem login). Reaproveita a consulta da própria
// conta (`getUserWithSocialById`, a mesma do /users/me), então a resposta tem
// de ser recortada CAMPO A CAMPO aqui: e-mail, telefone, nascimento, CPF
// mascarado, menoridade, responsável, papéis e assinatura são só do dono.
// Segurança A1-01 (2026-11-09): antes devolvia a linha inteira para qualquer um.
const UserStorage = require("../../storages/UserStorage");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("GetCreatorService");

const PUBLIC_PROFILE_KEYS = [
  "id_profile",
  "display_name",
  "is_clan",
  "id_category",
  "category",
  "profession_slug",
  "sub_profile_slug",
  "id_machine",
  "machine_slug",
  "machine_name",
  "bio",
  "avatar_url",
  "estado",
  "municipio",
  "is_user_account",
  "xp_total",
  "xp_level",
  "redes_sociais",
];

const PUBLIC_ACCOUNT_KEYS = ["id_profile", "xp_total", "xp_level", "id_category", "id_machine", "category", "estado", "municipio"];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function toPublicCreator(user) {
  const profiles = Array.isArray(user.profiles) ? user.profiles : [];
  return {
    id_user: user.id_user,
    username: user.username,
    avatar: user.avatar,
    bio: user.bio,
    estado: user.estado,
    municipio: user.municipio,
    is_verified: user.is_verified,
    account_profile: user.account_profile ? pick(user.account_profile, PUBLIC_ACCOUNT_KEYS) : null,
    redes_sociais: Array.isArray(user.redes_sociais) ? user.redes_sociais : [],
    // Só o que já está publicado (pago + visível + não apagado); comunidade
    // mora na mesma tabela e não é perfil.
    profiles: profiles
      .filter((p) => p && p.is_published && !p.is_community && !p.deleted_at)
      .map((p) => pick(p, PUBLIC_PROFILE_KEYS)),
  };
}

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
        return toPublicCreator(user);
      }
    );
  }

  static toPublicCreator(user) {
    return toPublicCreator(user);
  }
};
