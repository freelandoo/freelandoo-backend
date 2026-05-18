const UserStorage = require("../../storages/UserStorage");
const CountryService = require("../CountryService");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("UpdatePreferredLocaleService");

module.exports = class UpdatePreferredLocaleService {
  static async execute({ db, id_user, locale }) {
    return runWithLogs(
      log,
      "execute",
      () => ({ id_user, locale }),
      async () => {
        if (!CountryService.isValidLocale(locale)) {
          const err = new Error("Idioma inválido");
          err.statusCode = 400;
          throw err;
        }
        const updated = await UserStorage.updatePreferredLocale(db, id_user, locale);
        if (!updated) {
          const err = new Error("Usuário não encontrado");
          err.statusCode = 404;
          throw err;
        }
        return updated;
      }
    );
  }
};
