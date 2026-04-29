class ClanEarningSplitStorage {
  static async createBookingSplits(
    conn,
    { id_clan_profile, source_id, gross_amount_cents, member_amounts }
  ) {
    if (!member_amounts || member_amounts.length === 0) return [];
    const values = [];
    const params = [];
    let i = 1;
    for (const { id_member_profile, amount_cents } of member_amounts) {
      values.push(
        `($${i++}, $${i++}, 'booking', $${i++}, $${i++}, $${i++}, 'BRL', 'pending')`
      );
      params.push(
        id_clan_profile,
        id_member_profile,
        source_id,
        gross_amount_cents,
        amount_cents
      );
    }
    const r = await conn.query(
      `INSERT INTO public.tb_clan_earning_split
         (id_clan_profile, id_member_profile, source_type, source_id,
          gross_amount_cents, amount_cents, currency, status)
       VALUES ${values.join(", ")}
       RETURNING id_clan_earning_split, id_member_profile, amount_cents`,
      params
    );
    return r.rows;
  }

  static async existsForBooking(conn, source_id) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_clan_earning_split
        WHERE source_type = 'booking' AND source_id = $1
        LIMIT 1`,
      [String(source_id)]
    );
    return r.rowCount > 0;
  }
}

module.exports = ClanEarningSplitStorage;
