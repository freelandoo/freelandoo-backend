// src/services/MarketReportService.js
//
// RELATÓRIO DE MERCADO LOCAL (2026-09-28): quanto se cobra por um serviço ou
// produto num recorte — comunidade, cidade, região, estado ou país — com a
// comparação contra os recortes mais largos. As regras de o que entra moram em
// `utils/marketReport`; os números saem do que JÁ está cadastrado (ver lá).

const pool = require("../databases");
const MarketReportStorage = require("../storages/MarketReportStorage");
const { parseRequest, levelOf, compareLevels } = require("../utils/marketReport");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("MarketReportService");

class MarketReportService {
  static async report(user, query) {
    return runWithLogs(
      log,
      "report",
      () => ({ id_user: user?.id_user, kind: query?.kind }),
      async () => {
        const req = parseRequest(query);
        const level = levelOf(req);

        let community = null;
        if (level === "community") {
          community = await MarketReportStorage.communityPlace(pool, req.id_community);
          if (!community) return { error: "Comunidade não encontrada.", statusCode: 404 };
        }

        const place = {
          level,
          uf: req.uf,
          municipio: req.municipio,
          id_region: req.id_region,
          id_community: req.id_community,
        };

        const [stats, items, histogram] = await Promise.all([
          MarketReportStorage.stats(pool, req, place),
          MarketReportStorage.items(pool, req, place),
          MarketReportStorage.histogram(pool, req, place),
        ]);

        // A comparação com o entorno. Cada recorte é uma consulta própria: são
        // no máximo três, e juntá-las numa só esconderia a regra de cada uma.
        const compare = await Promise.all(
          compareLevels(level, req, community).map(async (c) => {
            const s = await MarketReportStorage.stats(pool, req, c);
            return { level: c.level, uf: c.uf || null, municipio: c.municipio || null, count: s.count, median: s.median };
          })
        );

        let subject = null;
        if (req.kind === "service" && req.id_category) {
          subject = await MarketReportStorage.categoryLabel(pool, req.id_category);
        } else if (req.kind === "product" && req.id_product_category) {
          subject = await MarketReportStorage.productCategoryLabel(pool, req.id_product_category);
        }

        let regionName = null;
        if (level === "region") {
          const r = await MarketReportStorage.regionLabel(pool, req.id_region);
          regionName = r ? `${r.name} · ${r.uf}` : null;
        }

        return {
          kind: req.kind,
          listing_kind: req.kind === "listing" ? req.listing_kind : undefined,
          subject,
          q: req.q,
          scope: {
            level,
            uf: req.uf || community?.uf || null,
            municipio: req.municipio || community?.municipio || null,
            region: regionName,
            community: community ? { id_profile: community.id_community, name: community.name } : null,
          },
          stats,
          items,
          histogram,
          compare,
          currency: "BRL",
        };
      }
    );
  }

  static async myCommunities(user) {
    if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
    return { communities: await MarketReportStorage.myCommunities(pool, user.id_user) };
  }
}

module.exports = MarketReportService;
