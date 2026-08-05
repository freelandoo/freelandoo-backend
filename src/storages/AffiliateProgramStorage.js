/**
 * Trilhos globais do programa de afiliados (mig 192).
 *
 * tb_affiliate_program_settings — versionado, a linha mais recente vence:
 *   commission_split_percent  quanto do pool vai ao afiliado (o resto vira desconto
 *                             do vinculado — SÓ no regime plataforma)
 *   seller_percent_min/max    trilhos do que o dono do produto pode destinar
 *   default_percent           usado quando o item tem affiliate_percent NULL
 *
 * tb_affiliate_commission_rule — uma linha por tipo de compra (source_context),
 * incluindo o regime ('platform' × 'user'). Ver o desenho em
 * docs/superpowers/specs/2026-08-05-afiliado-vitalicio-design.md.
 */
class AffiliateProgramStorage {
  static async getSettings(conn) {
    const { rows } = await conn.query(
      `SELECT *
         FROM public.tb_affiliate_program_settings
        WHERE effective_from <= NOW()
        ORDER BY effective_from DESC
        LIMIT 1`
    );
    return rows[0] || null;
  }

  /** Versiona: nunca faz UPDATE in place (histórico preservado, igual settings de afiliado). */
  static async createSettings(conn, {
    commission_split_percent,
    seller_percent_min,
    seller_percent_max,
    default_percent,
    notes = null,
    created_by = null,
  }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_affiliate_program_settings
         (commission_split_percent, seller_percent_min, seller_percent_max,
          default_percent, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        commission_split_percent,
        seller_percent_min,
        seller_percent_max,
        default_percent,
        notes,
        created_by,
      ]
    );
    return rows[0];
  }

  static async listRules(conn) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_affiliate_commission_rule
        ORDER BY regime DESC, source_context ASC`
    );
    return rows;
  }

  static async getRule(conn, source_context) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_affiliate_commission_rule
        WHERE source_context = $1
        LIMIT 1`,
      [source_context]
    );
    return rows[0] || null;
  }

  static async updateRule(conn, source_context, fields, updated_by = null) {
    const allowed = [
      "is_enabled", "percent", "percent_source", "creates_bond", "grants_discount",
      "max_pool_cents", "min_order_cents", "recurring_allowed", "max_recurring_cycles",
      "notes",
    ];
    const sets = [];
    const values = [];
    let i = 1;
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) {
        sets.push(`${k} = $${i++}`);
        values.push(fields[k]);
      }
    }
    if (sets.length === 0) return null;
    sets.push(`updated_at = NOW()`);
    sets.push(`updated_by = $${i++}`);
    values.push(updated_by);
    values.push(source_context);
    const { rows } = await conn.query(
      `UPDATE public.tb_affiliate_commission_rule
          SET ${sets.join(", ")}
        WHERE source_context = $${i}
        RETURNING *`,
      values
    );
    return rows[0] || null;
  }
}

module.exports = AffiliateProgramStorage;
