const CountryStorage = require("../storages/CountryStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CountryService");

const ALLOWED_LOCALES = ["pt-BR", "en", "es"];

class CountryService {
  static async listActive({ db }) {
    return runWithLogs(log, "listActive", () => ({}), async () => {
      return CountryStorage.listActive(db);
    });
  }

  static async getByIso2({ db, iso2 }) {
    return runWithLogs(
      log,
      "getByIso2",
      () => ({ iso2 }),
      async () => CountryStorage.findByIso2(db, iso2)
    );
  }

  static isValidLocale(locale) {
    return typeof locale === "string" && ALLOWED_LOCALES.includes(locale);
  }

  static getAllowedLocales() {
    return [...ALLOWED_LOCALES];
  }

  static normalizeIso2(iso2) {
    if (typeof iso2 !== "string") return null;
    const trimmed = iso2.trim().toUpperCase();
    return trimmed.length === 2 ? trimmed : null;
  }
}

module.exports = CountryService;
