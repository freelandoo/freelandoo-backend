const EnxameService = require("../services/EnxameService");

function handleError(res, err) {
  if (err instanceof EnxameService.ServiceError) {
    return res.status(err.status).json({ error: err.message });
  }
  throw err;
}

class EnxameController {
  static async listPublic(req, res) {
    try {
      const data = await EnxameService.listPublicEnxames();
      res.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
      return res.json(data);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async listCategories(req, res) {
    try {
      const id_enxame = Number(req.params.id_enxame);
      if (!Number.isFinite(id_enxame)) {
        return res.status(400).json({ error: "id_enxame inválido" });
      }
      const data = await EnxameService.listCategoriesOfEnxame(id_enxame);
      res.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
      return res.json(data);
    } catch (err) {
      return handleError(res, err);
    }
  }
}

module.exports = EnxameController;
