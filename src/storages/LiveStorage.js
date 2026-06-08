// src/storages/LiveStorage.js
// Acesso a dados das Lives. Por enquanto cobre o catálogo de presentes (loja
// gerenciável no admin). Os métodos de sessão de live entram nos próximos slices.
const GIFT_COLUMNS = `
  id_live_gift, name, emoji, color, animation, price_polens,
  sort_order, is_active, created_at, updated_at
`;

const ANIMATIONS = ["float", "burst", "rain", "pulse", "spin", "slide"];

// Colunas da sessão de live + dados do perfil/enxame para a faixa do Bees.
const LIVE_SELECT = `
  l.id_live, l.id_profile, l.id_user, l.room_name, l.title, l.status,
  l.peak_viewers, l.started_at, l.ended_at, l.created_at,
  p.display_name AS profile_display_name,
  p.avatar_url   AS profile_avatar_url,
  p.is_clan      AS profile_is_clan,
  u.username     AS owner_username,
  m.name  AS machine_name,
  m.slug  AS machine_slug,
  m.color_from  AS machine_color_from,
  m.color_to    AS machine_color_to,
  m.color_ring  AS machine_color_ring,
  m.color_accent AS machine_color_accent
`;

const LIVE_FROM = `
  FROM public.tb_live l
  JOIN public.tb_profile p ON p.id_profile = l.id_profile
  JOIN public.tb_user    u ON u.id_user    = l.id_user
  LEFT JOIN public.tb_category c ON c.id_category = p.id_category
  LEFT JOIN public.tb_machine  m ON m.id_machine  = COALESCE(c.id_machine, p.id_machine)
`;

module.exports = {
  ANIMATIONS,

  // ── Sessões de live ─────────────────────────────────────────────────────────

  // Perfil do usuário com flag is_paid (assinatura ativa). Gate de transmissão:
  // só perfil próprio e pago pode abrir live.
  async getOwnedProfileForLive(db, { id_profile, id_user }) {
    const { rows } = await db.query(
      `SELECT p.id_profile, p.id_user, p.display_name, p.is_active, p.is_clan,
              EXISTS (
                SELECT 1 FROM public.tb_profile_subscription ps
                 WHERE ps.id_profile = p.id_profile AND ps.status = 'active'
              ) AS is_paid
         FROM public.tb_profile p
        WHERE p.id_profile = $1 AND p.id_user = $2
        LIMIT 1`,
      [id_profile, id_user]
    );
    return rows[0] || null;
  },

  async getActiveByProfile(db, id_profile) {
    const { rows } = await db.query(
      `SELECT ${LIVE_SELECT} ${LIVE_FROM}
        WHERE l.id_profile = $1 AND l.status = 'live'
        LIMIT 1`,
      [id_profile]
    );
    return rows[0] || null;
  },

  async getById(db, id_live) {
    const { rows } = await db.query(
      `SELECT ${LIVE_SELECT} ${LIVE_FROM} WHERE l.id_live = $1 LIMIT 1`,
      [id_live]
    );
    return rows[0] || null;
  },

  async createLive(db, { id_profile, id_user, room_name, title }) {
    const { rows } = await db.query(
      `INSERT INTO public.tb_live (id_profile, id_user, room_name, title, status)
       VALUES ($1, $2, $3, $4, 'live')
       RETURNING id_live`,
      [id_profile, id_user, room_name, title || null]
    );
    // Re-seleciona com joins para devolver o shape completo.
    return this.getById(db, rows[0].id_live);
  },

  async listActive(db) {
    const { rows } = await db.query(
      `SELECT ${LIVE_SELECT} ${LIVE_FROM}
        WHERE l.status = 'live'
        ORDER BY l.started_at DESC`
    );
    return rows;
  },

  // Encerra a live (só do dono). Idempotente: só afeta linha 'live'.
  async endLive(db, { id_live, id_user }) {
    const { rows } = await db.query(
      `UPDATE public.tb_live
          SET status = 'ended', ended_at = NOW()
        WHERE id_live = $1 AND id_user = $2 AND status = 'live'
        RETURNING id_live`,
      [id_live, id_user]
    );
    return rows.length > 0;
  },

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
