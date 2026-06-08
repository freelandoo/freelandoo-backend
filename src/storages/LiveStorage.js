// src/storages/LiveStorage.js
// Acesso a dados das Lives. Por enquanto cobre o catálogo de presentes (loja
// gerenciável no admin). Os métodos de sessão de live entram nos próximos slices.
const GIFT_COLUMNS = `
  id_live_gift, name, emoji, color, animation, price_polens,
  sort_order, is_active, created_at, updated_at
`;

const ANIMATIONS = ["float", "burst", "rain", "pulse", "spin", "slide"];

module.exports = {
  ANIMATIONS,

  // ── Catálogo de presentes ──────────────────────────────────────────────────
  async listGifts(db, { onlyActive = false } = {}) {
    const where = onlyActive ? "WHERE is_active = TRUE" : "";
    const { rows } = await db.query(
      `SELECT ${GIFT_COLUMNS}
         FROM public.tb_live_gift
         ${where}
        ORDER BY sort_order ASC, created_at ASC`
    );
    return rows;
  },

  async getGiftById(db, id_live_gift) {
    const { rows } = await db.query(
      `SELECT ${GIFT_COLUMNS} FROM public.tb_live_gift WHERE id_live_gift = $1`,
      [id_live_gift]
    );
    return rows[0] || null;
  },

  async createGift(db, data) {
    const { rows } = await db.query(
      `INSERT INTO public.tb_live_gift
         (name, emoji, color, animation, price_polens, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, TRUE))
       RETURNING ${GIFT_COLUMNS}`,
      [
        data.name,
        data.emoji || "🎁",
        data.color || "#F2B705",
        data.animation || "float",
        Number.isFinite(data.price_polens) ? data.price_polens : 10,
        Number.isFinite(data.sort_order) ? data.sort_order : 0,
        data.is_active,
      ]
    );
    return rows[0];
  },

  async updateGift(db, id_live_gift, data) {
    const fields = [];
    const values = [id_live_gift];
    let idx = 2;
    const set = (col, val) => {
      fields.push(`${col} = $${idx++}`);
      values.push(val);
    };
    if (data.name != null) set("name", String(data.name));
    if (data.emoji != null) set("emoji", String(data.emoji));
    if (data.color != null) set("color", String(data.color));
    if (data.animation != null) set("animation", String(data.animation));
    if (data.price_polens != null) set("price_polens", Number(data.price_polens));
    if (data.sort_order != null) set("sort_order", Number(data.sort_order));
    if (data.is_active != null) set("is_active", !!data.is_active);
    if (!fields.length) return this.getGiftById(db, id_live_gift);

    fields.push("updated_at = NOW()");
    const { rows } = await db.query(
      `UPDATE public.tb_live_gift SET ${fields.join(", ")}
        WHERE id_live_gift = $1
        RETURNING ${GIFT_COLUMNS}`,
      values
    );
    return rows[0] || null;
  },

  async deleteGift(db, id_live_gift) {
    // Soft delete preserva integridade com tb_live_gift_event (histórico).
    const { rows } = await db.query(
      `UPDATE public.tb_live_gift SET is_active = FALSE, updated_at = NOW()
        WHERE id_live_gift = $1
        RETURNING id_live_gift`,
      [id_live_gift]
    );
    return rows.length > 0;
  },
};
