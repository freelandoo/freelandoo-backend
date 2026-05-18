const pool = require("../databases");
const SearchService = require("../services/search/SearchService");

class SearchController {
  static async search(req, res) {
    const {
      country,
      estado,
      municipio,
      platform,
      nicho,
      category,
      categories,
      id_machine,
      id_category,
      machine_slug,
      q,
      level_min,
      limit,
      offset,
    } = req.query;

    // Normaliza country: ISO-2 maiúsculo. "all" desliga o filtro (NULL).
    let normalizedCountry = null;
    if (country && country !== "all") {
      const c = String(country).trim().toUpperCase();
      if (c.length === 2) normalizedCountry = c;
    }

    const parsedCategories = Array.isArray(categories)
      ? categories.filter(Boolean)
      : typeof categories === "string" && categories.trim() !== ""
        ? categories.split(",").map((s) => s.trim()).filter(Boolean)
        : null;

    const parsedIdMachine = id_machine != null && id_machine !== "" ? Number(id_machine) : null;
    const parsedIdCategory = id_category != null && id_category !== "" ? Number(id_category) : null;
    const parsedLevelMin = level_min != null && level_min !== "" ? Number(level_min) : null;

    const data = await SearchService.execute({
      db: pool,
      filters: {
        country: normalizedCountry,
        estado: estado || null,
        municipio: municipio || null,
        platform: platform || null,
        nicho: nicho || null,
        category: category || null,
        categories: parsedCategories,
        id_machine: Number.isFinite(parsedIdMachine) ? parsedIdMachine : null,
        id_category: Number.isFinite(parsedIdCategory) ? parsedIdCategory : null,
        machine_slug: machine_slug || null,
        q: q || null,
        level_min: Number.isFinite(parsedLevelMin) ? parsedLevelMin : null,
      },
      pagination: {
        limit: limit ? Number(limit) : 20,
        offset: offset ? Number(offset) : 0,
      },
    });

    return res.status(200).json(data);
  }
}

module.exports = SearchController;
