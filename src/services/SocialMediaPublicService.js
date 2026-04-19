const pool = require("../databases");
const SocialMediaPublicStorage = require("../storages/SocialMediaPublicStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("SocialMediaPublicService");

class SocialMediaPublicService {
  static async getMeta() {
    return runWithLogs(log, "getMeta", () => ({}), async () => {
      const [types, follower_ranges] = await Promise.all([
        SocialMediaPublicStorage.listTypes(pool),
        SocialMediaPublicStorage.listFollowerRanges(pool),
      ]);

      return { types, follower_ranges };
    });
  }

  static async listTypes() {
    return runWithLogs(log, "listTypes", () => ({}), async () => {
      const types = await SocialMediaPublicStorage.listTypes(pool);
      return { types };
    });
  }

  static async listFollowerRanges() {
    return runWithLogs(log, "listFollowerRanges", () => ({}), async () => {
      const follower_ranges =
        await SocialMediaPublicStorage.listFollowerRanges(pool);
      return { follower_ranges };
    });
  }
}

module.exports = SocialMediaPublicService;
