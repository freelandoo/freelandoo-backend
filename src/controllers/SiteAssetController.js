const pool = require("../databases");
const SiteAssetStorage = require("../storages/SiteAssetStorage");
const uploadSiteAssetToR2 = require("../integrations/r2/uploadSiteAsset");

// Slot válido: home_(buyer|seller)_<...> ou tour_<...> (banners do tour de
// boas-vindas). Espelha lib/site-asset-slots.ts do front.
function isValidSlot(slot) {
  return /^(home_(buyer|seller)|tour)_[a-z0-9_]+$/.test(slot);
}

module.exports = {
  async listPublic(req, res) {
    const assets = await SiteAssetStorage.listAll(pool);
    return res.json({ assets });
  },

  async upload(req, res) {
    const slot_key = String(req.params.slot_key || "").trim();
    if (!isValidSlot(slot_key)) {
      return res.status(400).json({ error: "slot inválido" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "imagem não enviada" });
    }
    const image_url = await uploadSiteAssetToR2({
      file: req.file,
      slotKey: slot_key,
    });
    const asset = await SiteAssetStorage.upsert(pool, {
      slot_key,
      image_url,
      updated_by: req.user.id_user,
    });
    return res.status(201).json({ asset });
  },
};
