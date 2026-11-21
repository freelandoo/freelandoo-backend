// src/storages/BankConnectionStorage.js
//
// Bancos conectados (mig 462): conexões (Items da Malvo), contas, o registro de
// conexões cobradas, a idempotência do webhook e a gravação dos lançamentos na
// Vida Financeira. SQL puro; as regras moram no BankConnectionService.
//
// ⚠️ TODA LEITURA SOBE ATÉ O DONO NO WHERE (`id_user = $n`). O único caminho
// que lê sem dono é o do webhook/sweeper (`getByItemId`, `listForSweep`), que
// não devolve nada para fora do servidor.

const CONN_COLS = `id_connection, id_user, malvo_item_id, connector_id, institution_name,
  institution_logo, primary_color, is_sandbox, status, execution_status, needs_action,
  consent_expires_at, last_synced_at, synced_through, auto_sync_paused, viewed_at, created_at, updated_at, deleted_at`;

class BankConnectionStorage {
  // ─── conexões ─────────────────────────────────────────────────────────────
  static async listByUser(conn, id_user) {
    const r = await conn.query(
      `SELECT ${CONN_COLS} FROM public.tb_bank_connection
        WHERE id_user = $1 AND deleted_at IS NULL
        ORDER BY created_at`,
      [id_user]
    );
    return r.rows;
  }

  static async countLive(conn, id_user) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_bank_connection
        WHERE id_user = $1 AND deleted_at IS NULL`,
      [id_user]
    );
    return r.rows[0].n;
  }

  static async getForUser(conn, id_user, id_connection) {
    const r = await conn.query(
      `SELECT ${CONN_COLS} FROM public.tb_bank_connection
        WHERE id_connection = $1 AND id_user = $2 AND deleted_at IS NULL`,
      [id_connection, id_user]
    );
    return r.rows[0] || null;
  }

  /** Webhook/sweeper: pelo Item. Inclui as apagadas (para ignorar eventos atrasados). */
  static async getByItemId(conn, malvo_item_id) {
    const r = await conn.query(
      `SELECT ${CONN_COLS} FROM public.tb_bank_connection WHERE malvo_item_id = $1`,
      [malvo_item_id]
    );
    return r.rows[0] || null;
  }

  /**
   * Cria (ou revive) a conexão de um Item. O mesmo Item voltando (avoidDuplicates
   * da Malvo reaproveita) não vira linha nova.
   */
  static async upsertFromItem(conn, id_user, item) {
    const c = item?.connector || {};
    const r = await conn.query(
      `INSERT INTO public.tb_bank_connection
         (id_user, malvo_item_id, connector_id, institution_name, institution_logo, primary_color,
          is_sandbox, status, execution_status, needs_action, consent_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (malvo_item_id) DO UPDATE
          SET connector_id       = EXCLUDED.connector_id,
              institution_name   = EXCLUDED.institution_name,
              institution_logo   = EXCLUDED.institution_logo,
              primary_color      = EXCLUDED.primary_color,
              is_sandbox         = EXCLUDED.is_sandbox,
              status             = EXCLUDED.status,
              execution_status   = EXCLUDED.execution_status,
              needs_action       = EXCLUDED.needs_action,
              consent_expires_at = EXCLUDED.consent_expires_at,
              updated_at         = NOW()
        WHERE tb_bank_connection.id_user = EXCLUDED.id_user
       RETURNING ${CONN_COLS}, (xmax = 0) AS inserted`,
      [
        id_user,
        String(item.id),
        Number.isFinite(Number(c.id)) ? Number(c.id) : null,
        c.name ? String(c.name).slice(0, 120) : null,
        c.imageUrl ? String(c.imageUrl).slice(0, 500) : null,
        c.primaryColor ? String(c.primaryColor).replace(/[^0-9a-f]/gi, "").slice(0, 6) : null,
        c.isSandbox === true,
        item.status ? String(item.status).slice(0, 32) : null,
        item.executionStatus ? String(item.executionStatus).slice(0, 48) : null,
        itemNeedsAction(item),
        item.consentExpiresAt || null,
      ]
    );
    return r.rows[0] || null;
  }

  static async markSynced(conn, id_connection, { synced_through }) {
    await conn.query(
      `UPDATE public.tb_bank_connection
          SET last_synced_at = NOW(),
              synced_through = GREATEST(COALESCE(synced_through, $2::date), $2::date),
              updated_at = NOW()
        WHERE id_connection = $1`,
      [id_connection, synced_through]
    );
  }

  static async setAutoSyncPaused(conn, id_connection, paused) {
    await conn.query(
      `UPDATE public.tb_bank_connection SET auto_sync_paused = $2, updated_at = NOW() WHERE id_connection = $1`,
      [id_connection, !!paused]
    );
  }

  /** O dono abriu os bancos: marca o uso (o sweeper pausa quem está parado). */
  static async touchViewed(conn, id_user) {
    await conn.query(
      `UPDATE public.tb_bank_connection SET viewed_at = NOW()
        WHERE id_user = $1 AND deleted_at IS NULL`,
      [id_user]
    );
  }

  static async softDelete(conn, id_connection) {
    await conn.query(
      `UPDATE public.tb_bank_connection
          SET deleted_at = NOW(), needs_action = FALSE, updated_at = NOW()
        WHERE id_connection = $1 AND deleted_at IS NULL`,
      [id_connection]
    );
  }

  // ─── contas ───────────────────────────────────────────────────────────────
  static async upsertAccount(conn, { id_connection, id_user, account, bill }) {
    const a = account || {};
    const credit = a.creditData || {};
    const tail = a.number ? String(a.number).replace(/\D/g, "").slice(-4) : null;
    const r = await conn.query(
      `INSERT INTO public.tb_bank_account
         (id_connection, id_user, malvo_account_id, type, subtype, name, number_tail, currency,
          balance_cents, credit_limit_cents, bill_amount_cents, bill_due_date, balance_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       ON CONFLICT (malvo_account_id) DO UPDATE
          SET type = EXCLUDED.type, subtype = EXCLUDED.subtype, name = EXCLUDED.name,
              number_tail = EXCLUDED.number_tail, currency = EXCLUDED.currency,
              balance_cents = EXCLUDED.balance_cents,
              credit_limit_cents = EXCLUDED.credit_limit_cents,
              bill_amount_cents = EXCLUDED.bill_amount_cents,
              bill_due_date = EXCLUDED.bill_due_date,
              balance_at = NOW(), updated_at = NOW()
        WHERE tb_bank_account.id_user = EXCLUDED.id_user
       RETURNING id_account, type, subtype`,
      [
        id_connection,
        id_user,
        String(a.id),
        a.type ? String(a.type).slice(0, 16) : null,
        a.subtype ? String(a.subtype).slice(0, 32) : null,
        a.name ? String(a.name).slice(0, 160) : null,
        tail || null,
        a.currencyCode ? String(a.currencyCode).slice(0, 3) : "BRL",
        toCents(a.balance),
        toCents(credit.creditLimit ?? credit.availableCreditLimit ?? null),
        bill ? toCents(bill.totalAmount) : null,
        bill?.dueDate ? String(bill.dueDate).slice(0, 10) : null,
      ]
    );
    return r.rows[0] || null;
  }

  static async listAccountsByUser(conn, id_user) {
    const r = await conn.query(
      `SELECT a.id_account, a.id_connection, a.type, a.subtype, a.name, a.number_tail, a.currency,
              a.balance_cents, a.credit_limit_cents, a.bill_amount_cents, a.bill_due_date, a.balance_at
         FROM public.tb_bank_account a
         JOIN public.tb_bank_connection c ON c.id_connection = a.id_connection
        WHERE a.id_user = $1 AND c.id_user = $1 AND c.deleted_at IS NULL
        ORDER BY a.type, a.name`,
      [id_user]
    );
    return r.rows;
  }

  // ─── conexões cobradas (limite mensal) ───────────────────────────────────
  static async countConnectsThisMonth(conn, id_user) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_bank_connect_event
        WHERE id_user = $1
          AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
      [id_user]
    );
    return r.rows[0].n;
  }

  static async recordConnect(conn, id_user, kind) {
    await conn.query(`INSERT INTO public.tb_bank_connect_event (id_user, kind) VALUES ($1, $2)`, [id_user, kind]);
  }

  // ─── webhook ──────────────────────────────────────────────────────────────
  /** true = evento novo; false = reentrega (já visto). */
  static async claimWebhookEvent(conn, { event_id, event, item_id }) {
    const r = await conn.query(
      `INSERT INTO public.tb_bank_webhook_event (event_id, event, item_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [String(event_id).slice(0, 120), String(event || "").slice(0, 48), item_id ? String(item_id) : null]
    );
    return r.rowCount > 0;
  }

  static async pruneWebhookEvents(conn, days = 30) {
    const r = await conn.query(
      `DELETE FROM public.tb_bank_webhook_event WHERE received_at < NOW() - ($1::int * INTERVAL '1 day')`,
      [days]
    );
    return r.rowCount;
  }

  // ─── Vida Financeira ──────────────────────────────────────────────────────
  /**
   * Grava lançamentos importados (banco ou OFX). Repetido não duplica (UNIQUE
   * user_id+source+external_id); o que já existe tem só a categoria mantida —
   * a pessoa pode ter trocado, e a troca dela vence.
   * @returns {Promise<number>} quantos entraram de novo
   */
  static async insertEntries(conn, id_user, source, rows) {
    if (!rows.length) return 0;
    let inserted = 0;
    // Lotes de 200 para não estourar o limite de parâmetros do Postgres.
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const params = [];
      const values = chunk.map((row, j) => {
        const b = j * 8;
        params.push(
          id_user,
          row.direction,
          String(row.title || "Lançamento").slice(0, 120),
          row.category ? String(row.category).slice(0, 60) : null,
          Math.abs(Math.round(Number(row.amount_cents) || 0)),
          row.date,
          String(row.external_id).slice(0, 200),
          row.id_bank_account || null
        );
        return `($${b + 1}, $${b + 2}, 'oneoff', $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::date, '${source}', $${b + 7}, $${b + 8}::uuid)`;
      });
      const r = await conn.query(
        `INSERT INTO public.tb_wallet_finance_entry
           (user_id, direction, recurrence, title, category, amount_cents, entry_date, source, external_id, id_bank_account)
         VALUES ${values.join(",")}
         ON CONFLICT (user_id, source, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
        params
      );
      inserted += r.rowCount;
    }
    return inserted;
  }

  /** Desconectou: os lançamentos do banco saem junto (são dados do banco, não da pessoa). */
  static async deleteBankEntriesOfConnection(conn, id_user, id_connection) {
    const r = await conn.query(
      `DELETE FROM public.tb_wallet_finance_entry e
        USING public.tb_bank_account a
        WHERE e.id_bank_account = a.id_account
          AND a.id_connection = $2
          AND e.user_id = $1 AND a.id_user = $1
          AND e.source = 'bank'`,
      [id_user, id_connection]
    );
    return r.rowCount;
  }

  // ─── sweeper ──────────────────────────────────────────────────────────────
  /**
   * Conexões vivas com o estado do acesso do dono e o último uso da Carteira.
   * `has_access` usa a mesma régua do resto (pagou ou é admin).
   */
  static async listForSweep(conn, bankAccessSqlExpr) {
    const r = await conn.query(
      `SELECT c.id_connection, c.id_user, c.malvo_item_id, c.auto_sync_paused, c.last_synced_at,
              c.viewed_at, c.created_at, ba.paid_until,
              ${bankAccessSqlExpr} AS has_access
         FROM public.tb_bank_connection c
         LEFT JOIN public.tb_user_bank_access ba ON ba.id_user = c.id_user
        WHERE c.deleted_at IS NULL`
    );
    return r.rows;
  }
}

function itemNeedsAction(item) {
  const s = String(item?.status || "");
  const e = String(item?.executionStatus || "");
  if (s === "WAITING_USER_INPUT" || s === "WAITING_USER_ACTION" || s === "LOGIN_ERROR") return true;
  if (e === "USER_AUTHORIZATION_PENDING" && s !== "LOGIN_IN_PROGRESS") return true;
  if (/CONSENT|EXPIRED|REVOKED|INVALID_CREDENTIALS/i.test(e)) return true;
  if (item?.error?.code && /CONSENT|EXPIRED|REVOKED|CREDENTIALS/i.test(String(item.error.code))) return true;
  return false;
}

/** Decimal da Malvo (reais) → centavos inteiros. null fica null. */
function toCents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

module.exports = BankConnectionStorage;
module.exports.itemNeedsAction = itemNeedsAction;
module.exports.toCents = toCents;
