// Ledger da Verde Esmeralda (mig 330) — mesmo desenho da PolenStorage:
// toda mudança de saldo tem a sua linha, crédito/débito na MESMA transação do
// banco de quem chama, dedupe por (source, source_id).
const BRT_TODAY = `((NOW() AT TIME ZONE 'America/Sao_Paulo')::date AT TIME ZONE 'America/Sao_Paulo')`;

class EmeraldStorage {
  static async getSettings(conn) {
    const { rows } = await conn.query(`SELECT * FROM public.emerald_settings WHERE id = 1 LIMIT 1`);
    return rows[0] || null;
  }

  static async updateSettings(conn, patch) {
    const allowed = [
      "is_active", "conversion_enabled", "engagement_enabled",
      "engagement_daily_cap", "work_daily_cap",
      "points_like", "points_save", "points_comment", "points_share",
      "comment_min_chars", "reach_points_per_emerald", "coupon_gold_per_10_brl",
      "updated_by",
    ];
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        values.push(patch[key]);
        fields.push(`${key} = $${values.length}`);
      }
    }
    if (!fields.length) return this.getSettings(conn);
    const { rows } = await conn.query(
      `UPDATE public.emerald_settings SET ${fields.join(", ")}, updated_at = NOW() WHERE id = 1 RETURNING *`,
      values
    );
    return rows[0];
  }

  static async getOrCreateWallet(conn, user_id) {
    const { rows } = await conn.query(
      `INSERT INTO public.emerald_wallets (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING *`,
      [user_id]
    );
    return rows[0];
  }

  /** Trava a carteira (FOR UPDATE) — para quem lê o saldo e decide em cima dele. */
  static async lockWallet(conn, user_id) {
    await this.getOrCreateWallet(conn, user_id);
    const { rows } = await conn.query(
      `SELECT * FROM public.emerald_wallets WHERE user_id = $1 FOR UPDATE`,
      [user_id]
    );
    return rows[0];
  }

  static async getWallet(conn, user_id) {
    const { rows } = await conn.query(
      `SELECT * FROM public.emerald_wallets WHERE user_id = $1 LIMIT 1`,
      [user_id]
    );
    return rows[0] || null;
  }

  static async listTransactions(conn, user_id, { limit = 30, offset = 0 } = {}) {
    const { rows } = await conn.query(
      `SELECT * FROM public.emerald_transactions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [user_id, limit, offset]
    );
    return rows;
  }

  /** Crédito. Devolve null quando a ação já foi creditada (dedupe). */
  static async credit(conn, { user_id, wallet_id, amount, type, source, source_id, metadata }) {
    const value = Math.floor(Number(amount) || 0);
    if (value <= 0) return null;
    const { rows } = await conn.query(
      `WITH inserted AS (
         INSERT INTO public.emerald_transactions
           (user_id, wallet_id, type, amount, source, source_id, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, 'posted', $7)
         ON CONFLICT DO NOTHING
         RETURNING *
       ),
       updated_wallet AS (
         UPDATE public.emerald_wallets
            SET balance = balance + $4,
                lifetime_earned = lifetime_earned + $4,
                updated_at = NOW()
          WHERE id = $2 AND user_id = $1
            AND EXISTS (SELECT 1 FROM inserted)
          RETURNING *
       )
       SELECT (SELECT row_to_json(updated_wallet) FROM updated_wallet) AS wallet,
              (SELECT row_to_json(inserted) FROM inserted) AS transaction`,
      [user_id, wallet_id, type, value, source || null, source_id || null, metadata || {}]
    );
    const row = rows[0] || {};
    if (!row.transaction) return null;
    return { wallet: row.wallet, transaction: row.transaction };
  }

  /** Débito. null = saldo insuficiente (nada gravado). */
  static async debit(conn, { user_id, wallet_id, amount, type, source, source_id, metadata }) {
    const value = Math.floor(Math.abs(Number(amount) || 0));
    if (value <= 0) return null;
    const { rows: walletRows } = await conn.query(
      `UPDATE public.emerald_wallets
          SET balance = balance - $2,
              lifetime_spent = lifetime_spent + $2,
              updated_at = NOW()
        WHERE id = $1 AND user_id = $3 AND balance >= $2
        RETURNING *`,
      [wallet_id, value, user_id]
    );
    if (!walletRows[0]) return null;
    const { rows: txRows } = await conn.query(
      `INSERT INTO public.emerald_transactions
         (user_id, wallet_id, type, amount, source, source_id, status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,'posted',$7)
       RETURNING *`,
      [user_id, wallet_id, type, -value, source || null, source_id || null, metadata || {}]
    );
    return { wallet: walletRows[0], transaction: txRows[0] };
  }

  /**
   * Estorno de um crédito (desfazer curtida, por exemplo). Tira até o que
   * houver no saldo — o saldo nunca fica negativo — e só uma vez por
   * (source, source_id). Devolve null se nada foi estornado.
   */
  static async reverseCredit(conn, { user_id, wallet_id, amount, source, source_id, metadata }) {
    const value = Math.floor(Math.abs(Number(amount) || 0));
    if (value <= 0) return null;
    const { rows } = await conn.query(
      `WITH w AS (
         SELECT LEAST(balance, $3) AS take FROM public.emerald_wallets WHERE id = $2 AND user_id = $1 FOR UPDATE
       ),
       inserted AS (
         INSERT INTO public.emerald_transactions
           (user_id, wallet_id, type, amount, source, source_id, status, metadata)
         SELECT $1, $2, 'reversal', -(SELECT take FROM w), $4, $5, 'posted', $6
          WHERE (SELECT take FROM w) > 0
         ON CONFLICT DO NOTHING
         RETURNING *
       ),
       updated_wallet AS (
         UPDATE public.emerald_wallets
            SET balance = balance + (SELECT amount FROM inserted),
                updated_at = NOW()
          WHERE id = $2 AND EXISTS (SELECT 1 FROM inserted)
          RETURNING *
       )
       SELECT (SELECT row_to_json(updated_wallet) FROM updated_wallet) AS wallet,
              (SELECT row_to_json(inserted) FROM inserted) AS transaction`,
      [user_id, wallet_id, value, source || null, source_id || null, metadata || {}]
    );
    const row = rows[0] || {};
    if (!row.transaction) return null;
    return { wallet: row.wallet, transaction: row.transaction };
  }

  /** Soma líquida de hoje (dia de Brasília) dos tipos pedidos. */
  static async sumToday(conn, user_id, types) {
    const { rows } = await conn.query(
      `SELECT COALESCE(SUM(amount), 0)::int AS total
         FROM public.emerald_transactions
        WHERE user_id = $1 AND status = 'posted'
          AND created_at >= ${BRT_TODAY}
          AND (type = ANY($2) OR (type = 'reversal' AND metadata->>'reverses' = ANY($2)))`,
      [user_id, types]
    );
    return Number(rows[0]?.total) || 0;
  }

  static async findPosted(conn, source, source_id) {
    const { rows } = await conn.query(
      `SELECT * FROM public.emerald_transactions
        WHERE source = $1 AND source_id = $2 AND status = 'posted' LIMIT 1`,
      [source, source_id]
    );
    return rows[0] || null;
  }
}

module.exports = EmeraldStorage;
