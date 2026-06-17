const pool = require("../databases");
const SiteTextStorage = require("../storages/SiteTextStorage");

// Slot válido: home_(buyer|seller)_<...> ou tour_<...> (textos do tour de
// boas-vindas, editáveis pelo admin). Espelha o front.
function isValidSlot(slot) {
  return /^(home_(buyer|seller)|tour)_[a-z0-9_]+$/.test(slot);
}

module.exports = {
  async listPublic(req, res) {
    const texts = await SiteTextStorage.listAll(pool);
    return res.json({ texts });
  },

  async upsert(req, res) {
    const slot_key = String(req.params.slot_key || "").trim();
    if (!isValidSlot(slot_key)) {
      return res.status(400).json({ error: "slot inválido" });
    }
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    if (!content.trim()) {
      return res.status(400).json({ error: "conteúdo vazio" });
    }
    if (content.length > 2000) {
      return res.status(400).json({ error: "conteúdo muito longo" });
    }
    const text = await SiteTextStorage.upsert(pool, {
      slot_key,
      content,
      updated_by: req.user.id_user,
    });
    return res.status(201).json({ text });
  },
};
