const pool = require("../databases");
const SearchService = require("../services/search/SearchService");

class SearchController {
  static async search(req, res) {
    const {
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
      limit,
      offset,
    } = req.query;

    const parsedCategories = Array.isArray(categories)
      ? categories.filter(Boolean)
      : typeof categories === "string" && categories.trim() !== ""
        ? categories.split(",").map((s) => s.trim()).filter(Boolean)
        : null;

    const parsedIdMachine = id_machine != null && id_machine !== "" ? Number(id_machine) : null;
    const parsedIdCategory = id_category != null && id_category !== "" ? Number(id_category) : null;

    const data = await SearchService.execute({
      db: pool,
      filters: {
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
