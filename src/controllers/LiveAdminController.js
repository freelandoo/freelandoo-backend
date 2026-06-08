// src/controllers/LiveAdminController.js
const pool = require("../databases");
const LiveStorage = require("../storages/LiveStorage");

function validateGift(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name != null) {
    const name = String(body.name || "").trim();
    if (!name) return { error: "Nome é obrigatório" };
    out.name = name.slice(0, 60);
  }
  if (body.emoji != null) out.emoji = String(body.emoji).slice(0, 16);
  if (body.color != null) out.color = String(body.color).slice(0, 16);
  if (body.animation != null) {
    if (!LiveStorage.ANIMATIONS.includes(body.animation)) {
      return { error: "Animação inválida" };
    }
    out.animation = body.animation;
  }
  if (body.price_polens != null) {
    const p = Number(body.price_polens);
    if (!Number.isInteger(p) || p < 0) return { error: "Preço em Poléns inválido" };
    out.price_polens = p;
  }
  if (body.sort_order != null) out.sort_order = Number(body.sort_order) || 0;
  if (body.is_active != null) out.is_active = !!body.is_active;
  return out;
}

module.exports = {
  // GET /admin/lives/gifts
  async listGifts(req, res) {
    const gifts = await LiveStorage.listGifts(pool);
    return res.json({ gifts });
  },

  // POST /admin/lives/gifts
  async createGift(req, res) {
    const data = validateGift(req.body || {});
    if (data.error) return res.status(400).json({ error: data.error });
    const gift = await LiveStorage.createGift(pool, data);
    return res.status(201).json({ gift });
  },

  // PUT /admin/lives/gifts/:id
  async updateGift(req, res) {
    const data = validateGift(req.body || {}, { partial: true });
    if (data.error) return res.status(400).json({ error: data.error });
    const gift = await LiveStorage.updateGift(pool, req.params.id, data);
    if (!gift) return res.status(404).json({ error: "Presente não encontrado" });
    return res.json({ gift });
  },

  // DELETE /admin/lives/gifts/:id
  async deleteGift(req, res) {
    const ok = await LiveStorage.deleteGift(pool, req.params.id);
    if (!ok) return res.status(404).json({ error: "Presente não encontrado" });
    return res.json({ ok: true });
  },
};
