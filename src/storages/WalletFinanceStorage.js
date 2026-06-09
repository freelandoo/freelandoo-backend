// src/storages/WalletFinanceStorage.js
//
// Persistência da Vida Financeira (orçamento manual do user). Tudo escopado por
// user_id — nunca vaza entre contas.

module.exports = {
  // ── Categorias ─────────────────────────────────────────────────────────────
  async listCategories(db, userId, { direction = null, recurrence = null } = {}) {
    const { rows } = await db.query(
      `
      SELECT id, user_id, direction, recurrence, label, is_default
        FROM public.tb_wallet_finance_category
       WHERE (user_id IS NULL OR user_id = $1)
         AND ($2::text IS NULL OR direction = $2)
         AND ($3::text IS NULL OR recurrence = $3)
       ORDER BY is_default DESC, label
      `,
      [userId, direction, recurrence]
    );
    return rows;
  },

  async createCategory(db, userId, { direction, recurrence, label }) {
    const { rows } = await db.query(
      `
      INSERT INTO public.tb_wallet_finance_category (user_id, direction, recurrence, label, is_default)
      VALUES ($1, $2, $3, $4, FALSE)
      ON CONFLICT (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), direction, recurrence, label)
      DO UPDATE SET label = EXCLUDED.label
      RETURNING id, user_id, direction, recurrence, label, is_default
      `,
      [userId, direction, recurrence, label]
    );
    return rows[0];
  },

  // ── Lançamentos ────────────────────────────────────────────────────────────
  // Entradas/saídas aplicáveis a um mês (ym = YYYYMM). Inclui oneoff do mês +
  // recurring ativos que começaram até o mês.
  async monthEntries(db, userId, { ym, from, to }) {
    const { rows } = await db.query(
      `
      SELECT id, direction, recurrence, title, category,
             amount_cents::bigint AS amount_cents,
             entry_date, due_day, start_ym, active, created_at
        FROM public.tb_wallet_finance_entry
       WHERE user_id = $1
         AND (
           (recurrence = 'oneoff'    AND entry_date >= $2::date AND entry_date < $3::date)
           OR
           (recurrence = 'recurring' AND active = TRUE AND start_ym <= $4)
         )
       ORDER BY recurrence, entry_date DESC NULLS LAST, due_day NULLS LAST, created_at DESC
      `,
      [userId, from, to, ym]
    );
    return rows;
  },

  async createEntry(db, userId, e) {
    const { rows } = await db.query(
      `
      INSERT INTO public.tb_wallet_finance_entry
        (user_id, direction, recurrence, title, category, amount_cents,
         entry_date, due_day, start_ym, active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
      RETURNING id, direction, recurrence, title, category,
                amount_cents::bigint AS amount_cents, entry_date, due_day, start_ym, active, created_at
      `,
      [
        userId,
        e.direction,
        e.recurrence,
        e.title,
        e.category ?? null,
        e.amount_cents,
        e.entry_date ?? null,
        e.due_day ?? null,
        e.start_ym ?? null,
      ]
    );
    return rows[0];
  },

  async updateEntry(db, userId, id, patch) {
    const { rows } = await db.query(
      `
      UPDATE public.tb_wallet_finance_entry
         SET title        = COALESCE($3, title),
             category     = COALESCE($4, category),
             amount_cents = COALESCE($5, amount_cents),
             due_day      = COALESCE($6, due_day),
             active       = COALESCE($7, active),
             updated_at   = NOW()
       WHERE id = $1 AND user_id = $2
      RETURNING id, direction, recurrence, title, category,
                amount_cents::bigint AS amount_cents, entry_date, due_day, start_ym, active, created_at
      `,
      [
        id,
        userId,
        patch.title ?? null,
        patch.category ?? null,
        patch.amount_cents ?? null,
        patch.due_day ?? null,
        typeof patch.active === "boolean" ? patch.active : null,
      ]
    );
    return rows[0] || null;
  },

  async deleteEntry(db, userId, id) {
    const { rowCount } = await db.query(
      `DELETE FROM public.tb_wallet_finance_entry WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return rowCount > 0;
  },

  // Categorias usadas recentemente (chips de acesso rápido). Distinct por título.
  async recentTitles(db, userId, { direction, recurrence, limit = 8 }) {
    const { rows } = await db.query(
      `
      SELECT title, MAX(created_at) AS last_used
        FROM public.tb_wallet_finance_entry
       WHERE user_id = $1 AND direction = $2 AND recurrence = $3
       GROUP BY title
       ORDER BY last_used DESC
       LIMIT $4
      `,
      [userId, direction, recurrence, Math.min(20, Math.max(1, limit))]
    );
    return rows.map((r) => r.title);
  },
};
