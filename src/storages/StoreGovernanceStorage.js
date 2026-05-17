class StoreGovernanceStorage {
  static async get(conn) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_store_governance_settings WHERE id_settings = 1 LIMIT 1`
    );
    return rows[0] || null;
  }

  static async update(conn, patch, updated_by_user_id) {
    const allowed = [
      "service_fee_percent",
      "service_fee_fixed_cents",
      "service_fee_min_cents",
      "service_fee_max_cents",
      "processor_fee_mode",
      "processor_fee_percent_fallback",
      "processor_fee_fixed_cents_fallback",
    ];
    const fields = [];
    const values = [];
    let i = 1;
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) {
        fields.push(`${k} = $${i++}`);
        values.push(patch[k]);
      }
    }
    if (!fields.length) return this.get(conn);
    fields.push(`updated_by_user_id = $${i++}`);
    values.push(updated_by_user_id || null);
    fields.push("updated_at = NOW()");
    const { rows } = await conn.query(
      `UPDATE public.tb_store_governance_settings
          SET ${fields.join(", ")}
        WHERE id_settings = 1
        RETURNING *`,
      values
    );
    return rows[0] || null;
  }
}

module.exports = StoreGovernanceStorage;
