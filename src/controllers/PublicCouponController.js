const pool = require("../databases");

class PublicCouponController {
  /**
   * GET /public/coupon/:code
   * Retorna info pública pra renderizar a landing /oferta/[cupom].
   * Não calcula desconto (precisa de order_value_cents — fica para o checkout).
   */
  static async get(req, res) {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ error: "code obrigatório" });

    const { rows } = await pool.query(
      `SELECT c.id_coupon, c.code, c.is_active, c.expires_at, c.owner_user_id,
              u.username,
              p.display_name AS profile_display_name,
              p.avatar_url   AS profile_avatar_url,
              p.id_profile
         FROM public.tb_coupon c
    LEFT JOIN public.tb_user    u ON u.id_user = c.owner_user_id
    LEFT JOIN LATERAL (
           SELECT pr.display_name, pr.avatar_url, pr.id_profile
             FROM public.tb_profile pr
            WHERE pr.id_user = c.owner_user_id
              AND pr.is_visible = TRUE
              AND pr.deleted_at IS NULL
            ORDER BY pr.created_at ASC
            LIMIT 1
         ) p ON TRUE
        WHERE c.code = $1
        LIMIT 1`,
      [code]
    );

    const row = rows[0];
    if (!row) return res.status(404).json({ valid: false, error: "Cupom não encontrado" });

    const expired = row.expires_at && new Date(row.expires_at) < new Date();
    const valid = !!row.is_active && !expired;

    res.set("Cache-Control", "public, max-age=60");
    return res.json({
      valid,
      code: row.code,
      expires_at: row.expires_at,
      expired,
      owner: row.owner_user_id
        ? {
            username: row.username || null,
            display_name: row.profile_display_name || row.username || null,
            avatar_url: row.profile_avatar_url || null,
            id_profile: row.id_profile || null,
          }
        : null,
    });
  }
}

module.exports = PublicCouponController;
