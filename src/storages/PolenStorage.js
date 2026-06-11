class PolenStorage {
  static async getSettings(conn) {
    const { rows } = await conn.query(
      `SELECT * FROM public.polen_settings WHERE id = 1 LIMIT 1`
    );
    return rows[0] || null;
  }

  static async updateSettings(conn, patch) {
    const allowed = [
      "is_active",
      "polens_per_ad",
      "ads_per_day_per_user",
      "cooldown_seconds",
      "daily_polens_limit",
      "price_profile_activation",
      "price_premium_highlight",
      "price_post_boost",
      "price_profile_boost",
      "price_clan_highlight",
      "manifestation_admin_enabled",
      "manifestation_users_enabled",
      "manifestation_min_xp_level",
      "rewarded_provider",
      "rewarded_ad_unit_id",
      "updated_by",
    ];
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${key} = $${i++}`);
        values.push(patch[key]);
      }
    }
    if (!fields.length) return this.getSettings(conn);
    fields.push("updated_at = NOW()");
    const { rows } = await conn.query(
      `UPDATE public.polen_settings SET ${fields.join(", ")} WHERE id = 1 RETURNING *`,
      values
    );
    return rows[0];
  }

  static async getOrCreateWallet(conn, user_id) {
    const { rows } = await conn.query(
      `INSERT INTO public.polen_wallets (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING *`,
      [user_id]
    );
    return rows[0];
  }

  static async getWallet(conn, user_id) {
    const { rows } = await conn.query(
      `SELECT * FROM public.polen_wallets WHERE user_id = $1 LIMIT 1`,
      [user_id]
    );
    return rows[0] || null;
  }

  static async listTransactions(conn, user_id, { limit = 30, offset = 0 } = {}) {
    const { rows } = await conn.query(
      `SELECT *
         FROM public.polen_transactions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [user_id, limit, offset]
    );
    return rows;
  }

  static async credit(conn, { user_id, wallet_id, amount, type, source, source_id, metadata }) {
    const { rows: walletRows } = await conn.query(
      `UPDATE public.polen_wallets
          SET balance = balance + $2,
              lifetime_earned = lifetime_earned + $2,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [wallet_id, amount]
    );
    const { rows: txRows } = await conn.query(
      `INSERT INTO public.polen_transactions
         (user_id, wallet_id, type, amount, source, source_id, status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,'posted',$7)
       RETURNING *`,
      [user_id, wallet_id, type, amount, source || null, source_id || null, metadata || {}]
    );
    return { wallet: walletRows[0], transaction: txRows[0] };
  }

  static async debit(conn, { user_id, wallet_id, amount, type, source, source_id, metadata }) {
    const { rows: walletRows } = await conn.query(
      `UPDATE public.polen_wallets
          SET balance = balance - $2,
              lifetime_spent = lifetime_spent + $2,
              updated_at = NOW()
        WHERE id = $1
          AND user_id = $3
          AND balance >= $2
        RETURNING *`,
      [wallet_id, amount, user_id]
    );
    if (!walletRows[0]) return null;
    const { rows: txRows } = await conn.query(
      `INSERT INTO public.polen_transactions
         (user_id, wallet_id, type, amount, source, source_id, status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,'posted',$7)
       RETURNING *`,
      [user_id, wallet_id, type, -Math.abs(amount), source || null, source_id || null, metadata || {}]
    );
    return { wallet: walletRows[0], transaction: txRows[0] };
  }

  static async reverseCredit(conn, { user_id, wallet_id, amount, source, source_id, metadata }) {
    const value = Math.abs(Number(amount) || 0);
    if (value <= 0) return null;
    const { rows } = await conn.query(
      `WITH inserted AS (
         INSERT INTO public.polen_transactions
           (user_id, wallet_id, type, amount, source, source_id, status, metadata)
         VALUES ($1, $2, 'reversal', $3, $4, $5, 'posted', $6)
         ON CONFLICT DO NOTHING
         RETURNING *
       ),
       updated_wallet AS (
         UPDATE public.polen_wallets
            SET balance = balance + (SELECT amount FROM inserted),
                updated_at = NOW()
          WHERE id = $2
            AND user_id = $1
            AND EXISTS (SELECT 1 FROM inserted)
          RETURNING *
       )
       SELECT
         (SELECT row_to_json(updated_wallet) FROM updated_wallet) AS wallet,
         (SELECT row_to_json(inserted) FROM inserted) AS transaction`,
      [
        user_id,
        wallet_id,
        -value,
        source || null,
        source_id || null,
        metadata || {},
      ]
    );
    const row = rows[0] || {};
    if (!row.transaction) return null;
    return { wallet: row.wallet, transaction: row.transaction };
  }

  static async createRewardEvent(conn, data) {
    const { rows } = await conn.query(
      `INSERT INTO public.rewarded_ad_events
         (user_id, provider, ad_unit_id, reward_token, reward_amount, status, ip_hash, user_agent_hash, metadata)
       VALUES ($1,$2,$3,$4,$5,'requested',$6,$7,$8)
       RETURNING *`,
      [
        data.user_id,
        data.provider,
        data.ad_unit_id || null,
        data.reward_token,
        data.reward_amount,
        data.ip_hash || null,
        data.user_agent_hash || null,
        data.metadata || {},
      ]
    );
    return rows[0];
  }

  static async getRewardEventByToken(conn, token) {
    const { rows } = await conn.query(
      `SELECT * FROM public.rewarded_ad_events WHERE reward_token = $1 LIMIT 1`,
      [token]
    );
    return rows[0] || null;
  }

  static async markRewarded(conn, token) {
    const { rows } = await conn.query(
      `UPDATE public.rewarded_ad_events
          SET status = 'rewarded', watched_at = COALESCE(watched_at, NOW()), credited_at = NOW()
        WHERE reward_token = $1
          AND status = 'requested'
          AND created_at > NOW() - INTERVAL '30 minutes'
        RETURNING *`,
      [token]
    );
    return rows[0] || null;
  }

  static async countRewardedToday(conn, user_id) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS ads,
              COALESCE(SUM(reward_amount), 0)::int AS polens,
              MAX(created_at) AS last_event_at
         FROM public.rewarded_ad_events
        WHERE user_id = $1
          AND created_at >= ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date AT TIME ZONE 'America/Sao_Paulo')
          AND status IN ('requested','watched','rewarded')`,
      [user_id]
    );
    return rows[0] || { ads: 0, polens: 0, last_event_at: null };
  }

  static async metrics(conn) {
    const { rows } = await conn.query(
      `WITH today_tx AS (
         SELECT *
           FROM public.polen_transactions
          WHERE created_at >= ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date AT TIME ZONE 'America/Sao_Paulo')
       ), today_ads AS (
         SELECT *
           FROM public.rewarded_ad_events
          WHERE created_at >= ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date AT TIME ZONE 'America/Sao_Paulo')
       )
       SELECT
         COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)::int AS polens_issued_today,
         ABS(COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0))::int AS polens_spent_today,
         (SELECT COUNT(DISTINCT user_id)::int FROM today_tx WHERE amount > 0) AS users_earned_today,
         (SELECT COUNT(*)::int FROM today_ads WHERE status = 'rewarded') AS ads_completed_today,
         (SELECT COUNT(*)::int FROM today_ads) AS ads_requested_today,
         (SELECT COUNT(*)::int FROM today_tx WHERE amount < 0) AS products_purchased_today
       FROM today_tx`
    );
    return rows[0] || {};
  }

  static async getUserManifestationEligibility(conn, user_id) {
    const { rows } = await conn.query(
      `SELECT
         EXISTS (
           SELECT 1
             FROM public.tb_user_role ur
             JOIN public.tb_role r ON r.id_role = ur.id_role
            WHERE ur.id_user = $1
              AND ur.is_active = TRUE
              AND r.is_active = TRUE
              AND r.desc_role = 'Administrator'
         ) AS is_admin,
         COALESCE(MAX(COALESCE(p.xp_level, 0)), 0)::int AS max_xp_level
       FROM public.tb_user u
       LEFT JOIN public.tb_profile p
         ON p.id_user = u.id_user
        AND COALESCE(p.is_clan, FALSE) = FALSE
        AND p.deleted_at IS NULL
       WHERE u.id_user = $1
       GROUP BY u.id_user`,
      [user_id]
    );
    return rows[0] || { is_admin: false, max_xp_level: 0 };
  }

  static async activateProfileWithPolens(conn, { user_id, id_profile, amount }) {
    const { rows: profileRows } = await conn.query(
      `SELECT id_profile FROM public.tb_profile
        WHERE id_profile = $1 AND id_user = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [id_profile, user_id]
    );
    if (!profileRows[0]) return null;
    const { rows } = await conn.query(
      `INSERT INTO public.tb_profile_subscription
         (id_user, id_profile, status, amount_cents, currency, paid_at, raw_event)
       VALUES ($1,$2,'active',0,'PLN',NOW(),$3)
       RETURNING *`,
      [user_id, id_profile, { source: "polens", amount }]
    );
    return rows[0];
  }
}

module.exports = PolenStorage;
