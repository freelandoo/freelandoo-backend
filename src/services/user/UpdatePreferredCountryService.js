const UserStorage = require("../../storages/UserStorage");
const CountryService = require("../CountryService");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("UpdatePreferredCountryService");

module.exports = class UpdatePreferredCountryService {
  static async execute({ db, id_user, country }) {
    return runWithLogs(
      log,
      "execute",
      () => ({ id_user, country }),
      async () => {
        const iso2 = CountryService.normalizeIso2(country);
        if (!iso2) {
          const err = new Error("Código de país inválido");
          err.statusCode = 400;
          throw err;
        }

        const exists = await CountryService.getByIso2({ db, iso2 });
        if (!exists || !exists.is_active) {
          const err = new Error("País não suportado");
          err.statusCode = 400;
          throw err;
        }

        const updated = await UserStorage.updatePreferredCountry(db, id_user, iso2);
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
