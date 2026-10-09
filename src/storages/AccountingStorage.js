// src/storages/AccountingStorage.js
// SQL do painel de Contabilidade dos admins (mig 277). Sem regra de negócio:
// quem valida e calcula é o AccountingService / utils/accountingTax.

const COMPANY_COLS = `
  c.id_company, c.name, c.cnpj, c.regime, c.simples_anexo, c.municipio, c.uf,
  c.notes, c.created_at, c.updated_at`;

const ENTRY_COLS = `
  e.id_entry, e.id_company, to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date,
  e.entry_type, e.amount_cents::bigint AS amount_cents, e.description,
  e.counterparty, e.document_ref, e.id_obligation, e.created_at`;

const OBLIGATION_COLS = `
  o.id_obligation, o.id_company, o.kind, o.name, o.sphere,
  to_char(o.competence, 'YYYY-MM-DD') AS competence,
  to_char(o.due_date, 'YYYY-MM-DD') AS due_date,
  o.amount_cents::bigint AS amount_cents, o.status,
  to_char(o.paid_at, 'YYYY-MM-DD') AS paid_at,
  o.paid_amount_cents::bigint AS paid_amount_cents,
  o.receipt_key, o.receipt_mime, o.notes, o.source, o.created_at, o.updated_at`;

// BIGINT volta como string do driver `pg`; o front espera número.
function num(row, ...keys) {
  if (!row) return row;
  for (const k of keys) if (row[k] != null) row[k] = Number(row[k]);
  return row;
}
const entryRow = (r) => num(r, "amount_cents");
const obligationRow = (r) => num(r, "amount_cents", "paid_amount_cents");

class AccountingStorage {
  // ─── Empresas ──────────────────────────────────────────────────────────────
  static async listCompanies(conn) {
    const r = await conn.query(
      `SELECT ${COMPANY_COLS},
              (SELECT COUNT(*)::int FROM public.tb_acct_obligation o
                WHERE o.id_company = c.id_company AND o.status = 'pending'
                  AND o.due_date < CURRENT_DATE) AS overdue_count
         FROM public.tb_acct_company c
        WHERE c.deleted_at IS NULL
        ORDER BY c.name`,
    );
    return r.rows;
  }

  static async getCompany(conn, id_company) {
    const r = await conn.query(
      `SELECT ${COMPANY_COLS} FROM public.tb_acct_company c
        WHERE c.id_company = $1 AND c.deleted_at IS NULL`,
      [id_company],
    );
    return r.rows[0] || null;
  }

  static async createCompany(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_acct_company AS c
         (name, cnpj, regime, simples_anexo, municipio, uf, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COMPANY_COLS}`,
      [data.name, data.cnpj, data.regime, data.simples_anexo, data.municipio, data.uf, data.notes, data.created_by],
    );
    return r.rows[0];
  }

  static async updateCompany(conn, id_company, data) {
    const r = await conn.query(
      `UPDATE public.tb_acct_company AS c
          SET name = $2, cnpj = $3, regime = $4, simples_anexo = $5,
              municipio = $6, uf = $7, notes = $8, updated_at = NOW()
        WHERE c.id_company = $1 AND c.deleted_at IS NULL
        RETURNING ${COMPANY_COLS}`,
      [id_company, data.name, data.cnpj, data.regime, data.simples_anexo, data.municipio, data.uf, data.notes],
    );
    return r.rows[0] || null;
  }

  static async softDeleteCompany(conn, id_company) {
    const r = await conn.query(
      `UPDATE public.tb_acct_company SET deleted_at = NOW(), updated_at = NOW()
        WHERE id_company = $1 AND deleted_at IS NULL RETURNING id_company`,
      [id_company],
    );
    return r.rowCount > 0;
  }

  // ─── Livro caixa ───────────────────────────────────────────────────────────
  static async listEntries(conn, id_company, { from, to }) {
    const r = await conn.query(
      `SELECT ${ENTRY_COLS} FROM public.tb_acct_entry e
        WHERE e.id_company = $1
          AND ($2::date IS NULL OR e.entry_date >= $2::date)
          AND ($3::date IS NULL OR e.entry_date <= $3::date)
        ORDER BY e.entry_date DESC, e.created_at DESC`,
      [id_company, from || null, to || null],
    );
    return r.rows.map(entryRow);
  }

  static async getEntry(conn, id_company, id_entry) {
    const r = await conn.query(
      `SELECT ${ENTRY_COLS} FROM public.tb_acct_entry e
        WHERE e.id_company = $1 AND e.id_entry = $2`,
      [id_company, id_entry],
    );
    return entryRow(r.rows[0] || null);
  }

  static async createEntry(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_acct_entry AS e
         (id_company, entry_date, entry_type, amount_cents, description,
          counterparty, document_ref, id_obligation, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${ENTRY_COLS}`,
      [data.id_company, data.entry_date, data.entry_type, data.amount_cents, data.description,
        data.counterparty, data.document_ref, data.id_obligation, data.created_by],
    );
    return entryRow(r.rows[0]);
  }

  static async updateEntry(conn, id_company, id_entry, data) {
    const r = await conn.query(
      `UPDATE public.tb_acct_entry AS e
          SET entry_date = $3, entry_type = $4, amount_cents = $5, description = $6,
              counterparty = $7, document_ref = $8, updated_at = NOW()
        WHERE e.id_company = $1 AND e.id_entry = $2
        RETURNING ${ENTRY_COLS}`,
      [id_company, id_entry, data.entry_date, data.entry_type, data.amount_cents,
        data.description, data.counterparty, data.document_ref],
    );
    return entryRow(r.rows[0] || null);
  }

  static async deleteEntry(conn, id_company, id_entry) {
    const r = await conn.query(
      `DELETE FROM public.tb_acct_entry WHERE id_company = $1 AND id_entry = $2`,
      [id_company, id_entry],
    );
    return r.rowCount > 0;
  }

  /** Totais por tipo num intervalo [from, to] — base do resumo e da RBT12. */
  static async sumByType(conn, id_company, from, to) {
    const r = await conn.query(
      `SELECT entry_type, COALESCE(SUM(amount_cents), 0)::bigint AS total
         FROM public.tb_acct_entry
        WHERE id_company = $1 AND entry_date >= $2::date AND entry_date <= $3::date
        GROUP BY entry_type`,
      [id_company, from, to],
    );
    const out = {};
    for (const row of r.rows) out[row.entry_type] = Number(row.total);
    return out;
  }

  /** Série mensal (últimos N meses) de entradas e saídas. */
  static async monthlySeries(conn, id_company, from) {
    const r = await conn.query(
      `SELECT to_char(date_trunc('month', entry_date), 'YYYY-MM') AS month,
              entry_type, COALESCE(SUM(amount_cents), 0)::bigint AS total
         FROM public.tb_acct_entry
        WHERE id_company = $1 AND entry_date >= $2::date
        GROUP BY 1, 2
        ORDER BY 1`,
      [id_company, from],
    );
    return r.rows.map((row) => ({ ...row, total: Number(row.total) }));
  }

  // ─── Guias e obrigações ────────────────────────────────────────────────────
  static async listObligations(conn, id_company, { status, from, to }) {
    const r = await conn.query(
      `SELECT ${OBLIGATION_COLS} FROM public.tb_acct_obligation o
        WHERE o.id_company = $1
          AND ($2::text IS NULL OR o.status = $2::text)
          AND ($3::date IS NULL OR o.due_date >= $3::date)
          AND ($4::date IS NULL OR o.due_date <= $4::date)
        ORDER BY o.due_date, o.name`,
      [id_company, status || null, from || null, to || null],
    );
    return r.rows.map(obligationRow);
  }

  static async getObligation(conn, id_company, id_obligation) {
    const r = await conn.query(
      `SELECT ${OBLIGATION_COLS} FROM public.tb_acct_obligation o
        WHERE o.id_company = $1 AND o.id_obligation = $2`,
      [id_company, id_obligation],
    );
    return obligationRow(r.rows[0] || null);
  }

  static async createObligation(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_acct_obligation AS o
         (id_company, kind, name, sphere, competence, due_date, amount_cents,
          notes, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${OBLIGATION_COLS}`,
      [data.id_company, data.kind, data.name, data.sphere, data.competence, data.due_date,
        data.amount_cents, data.notes, data.source || "manual", data.created_by],
    );
    return obligationRow(r.rows[0]);
  }

  /** Versão do gerador: a mesma obrigação gerada não nasce duas vezes. */
  static async createGeneratedObligation(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_acct_obligation AS o
         (id_company, kind, name, sphere, competence, due_date, amount_cents,
          notes, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'generated', $9)
       ON CONFLICT (id_company, name, competence) WHERE source = 'generated'
       DO NOTHING
       RETURNING o.id_obligation`,
      [data.id_company, data.kind, data.name, data.sphere, data.competence, data.due_date,
        data.amount_cents, data.notes, data.created_by],
    );
    return r.rowCount > 0;
  }

  static async updateObligation(conn, id_company, id_obligation, data) {
    const r = await conn.query(
      `UPDATE public.tb_acct_obligation AS o
          SET kind = $3, name = $4, sphere = $5, competence = $6, due_date = $7,
              amount_cents = $8, notes = $9, updated_at = NOW()
        WHERE o.id_company = $1 AND o.id_obligation = $2
        RETURNING ${OBLIGATION_COLS}`,
      [id_company, id_obligation, data.kind, data.name, data.sphere, data.competence,
        data.due_date, data.amount_cents, data.notes],
    );
    return obligationRow(r.rows[0] || null);
  }

  /**
   * Muda o status. `paid_at`/`paid_amount_cents` são calculados no JS e chegam
   * prontos (NULL ao reabrir) — usar o mesmo parâmetro como coluna e dentro de
   * CASE faz o Postgres deduzir tipos inconsistentes (42P08).
   */
  static async setObligationStatus(conn, id_company, id_obligation, { status, paid_at, paid_amount_cents }) {
    const r = await conn.query(
      `UPDATE public.tb_acct_obligation AS o
          SET status = $3, paid_at = $4::date, paid_amount_cents = $5, updated_at = NOW()
        WHERE o.id_company = $1 AND o.id_obligation = $2
        RETURNING ${OBLIGATION_COLS}`,
      [id_company, id_obligation, status, paid_at, paid_amount_cents],
    );
    return obligationRow(r.rows[0] || null);
  }

  static async setReceipt(conn, id_company, id_obligation, { receipt_key, receipt_mime }) {
    const r = await conn.query(
      `UPDATE public.tb_acct_obligation AS o
          SET receipt_key = $3, receipt_mime = $4, updated_at = NOW()
        WHERE o.id_company = $1 AND o.id_obligation = $2
        RETURNING ${OBLIGATION_COLS}`,
      [id_company, id_obligation, receipt_key, receipt_mime],
    );
    return obligationRow(r.rows[0] || null);
  }

  static async deleteObligation(conn, id_company, id_obligation) {
    const r = await conn.query(
      `DELETE FROM public.tb_acct_obligation
        WHERE id_company = $1 AND id_obligation = $2
        RETURNING receipt_key`,
      [id_company, id_obligation],
    );
    return r.rows[0] || null;
  }

  // ─── Selic ─────────────────────────────────────────────────────────────────
  static async listSelic(conn) {
    const r = await conn.query(
      `SELECT to_char(month, 'YYYY-MM') AS month, rate::float8 AS rate
         FROM public.tb_acct_selic ORDER BY month DESC`,
    );
    return r.rows;
  }

  static async upsertSelic(conn, month, rate) {
    const r = await conn.query(
      `INSERT INTO public.tb_acct_selic (month, rate) VALUES ($1::date, $2)
       ON CONFLICT (month) DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW()
       RETURNING to_char(month, 'YYYY-MM') AS month, rate::float8 AS rate`,
      [month, rate],
    );
    return r.rows[0];
  }

  static async deleteSelic(conn, month) {
    const r = await conn.query(`DELETE FROM public.tb_acct_selic WHERE month = $1::date`, [month]);
    return r.rowCount > 0;
  }
}

module.exports = AccountingStorage;
