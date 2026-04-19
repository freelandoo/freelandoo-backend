const SearchStorage = require("../../storages/SearchStorage");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("SearchService");

class SearchService {
  static async execute({ db, filters, pagination }) {
    return runWithLogs(
      log,
      "execute",
      () => ({
        limit: pagination?.limit,
        offset: pagination?.offset,
        hasFilters: !!(filters && Object.keys(filters).length),
      }),
      async () => {
        const limit = Number.isFinite(pagination?.limit)
          ? pagination.limit
          : 20;
        const offset = Number.isFinite(pagination?.offset)
          ? pagination.offset
          : 0;

        const safeLimit = Math.min(Math.max(limit, 1), 50);
        const safeOffset = Math.max(offset, 0);

        return SearchStorage.searchCreators(db, {
          ...filters,
          limit: safeLimit,
          offset: safeOffset,
        });
      }
    );
  }
}

module.exports = SearchService;
