// src/storages/DebtStorage.js
// SQL do feed de boletos (A2, mig 338).
//
// ⚠️ PROJEÇÃO PÚBLICA É CAMPO A CAMPO: o feed devolve beneficiário, valor e
// vencimento — nada do dono (nem nome), nada do pagador do boleto, e a linha
// digitável só para quem segura a reserva viva ou para o próprio dono.
//
// ⚠️ VENCIDO E RESERVA SÃO LAZY: `due_date >= hoje (Brasília)` e
// `reserved_until > NOW()` são lidos aqui, sem job.

const TODAY_SQL = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

/** Boleto com 3+ denúncias abertas sai do feed até a moderação olhar. */
const REPORT_HIDE = 3;

const PUBLIC_COLS = `b.id_bill, b.bill_kind, b.amount_cents, b.due_date, b.beneficiary, b.created_at`;

class DebtStorage {
  /* ------------------------------ régua ---------------------------------- */

  static async getSettings(conn) {
    const r = await conn.query(
      `SELECT max_open, max_amount_cents, reserve_minutes, helper_emerald, is_active, updated_at
         FROM public.tb_debt_settings WHERE id = 1`
    );
    // Sem a linha, o lado seguro é PAUSADO.
    return (
      r.rows[0] || { max_open: 0, max_amount_cents: 1, reserve_minutes: 30, helper_emerald: 0, is_active: false }
    );
  }

  static async updateSettings(conn, patch, id_admin) {
    const allowed = ["max_open", "max_amount_cents", "reserve_minutes", "helper_emerald", "is_active"];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (patch[k] === undefined) continue;
      vals.push(k === "is_active" ? !!patch[k] : Math.max(0, Math.round(Number(patch[k]) || 0)));
      sets.push(`${k} = $${vals.length}`);
    }
    if (!sets.length) return DebtStorage.getSettings(conn);
    vals.push(id_admin || null);
    const r = await conn.query(
      `UPDATE public.tb_debt_settings
          SET ${sets.join(", ")}, updated_by = $${vals.length}, updated_at = NOW()
        WHERE id = 1
        RETURNING max_open, max_amount_cents, reserve_minutes, helper_emerald, is_active, updated_at`,
      vals
    );
    return r.rows[0];
  }

  /* ------------------------------ pessoa --------------------------------- */

  /** O que o guard de postar precisa saber da pessoa. CPF nunca sai daqui. */
  static async getPoster(conn, id_user) {
    const r = await conn.query(
      `SELECT u.id_user,
              (u.cpf IS NOT NULL) AS has_cpf,
              EXTRACT(YEAR FROM AGE(CURRENT_DATE, u.data_nascimento))::int AS age,
              u.needs_debt_help
         FROM public.tb_user u
        WHERE u.id_user = $1`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  static async countOpen(conn, id_user) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_debt_bill
        WHERE id_user = $1
          AND status IN ('review', 'open', 'claimed')
          AND due_date >= ${TODAY_SQL}`,
      [id_user]
    );
    return r.rows[0]?.n || 0;
  }

  /* ------------------------------ escrita -------------------------------- */

  static async create(conn, { id_user, line_digits, bill_kind, amount_cents, due_date, beneficiary }) {
    const r = await conn.query(
      `INSERT INTO public.tb_debt_bill
         (id_user, line_digits, bill_kind, amount_cents, due_date, beneficiary)
       VALUES ($1, $2, $3, $4, $5::date, $6)
       ON CONFLICT DO NOTHING
       RETURNING id_bill, bill_kind, amount_cents, due_date, beneficiary, status, created_at`,
      [id_user, line_digits, bill_kind, amount_cents, due_date, beneficiary]
    );
    return r.rows[0] || null;
  }

  static async getById(conn, id_bill, { forUpdate = false } = {}) {
    const r = await conn.query(
      `SELECT b.*, (b.due_date < ${TODAY_SQL}) AS expired
         FROM public.tb_debt_bill b
        WHERE b.id_bill = $1
        ${forUpdate ? "FOR UPDATE" : ""}`,
      [id_bill]
    );
    return r.rows[0] || null;
  }

  /**
   * Reserva ATÔMICA: um UPDATE condicional decide quem ganha quando duas
   * pessoas apertam "Vou pagar" no mesmo segundo.
   */
  static async reserve(conn, id_bill, id_user, minutes) {
    const r = await conn.query(
      `UPDATE public.tb_debt_bill
          SET reserved_by = $2,
              reserved_until = NOW() + ($3::int * INTERVAL '1 minute'),
              updated_at = NOW()
        WHERE id_bill = $1
          AND status = 'open'
          AND id_user <> $2
          AND due_date >= ${TODAY_SQL}
          AND (reserved_by IS NULL OR reserved_until <= NOW() OR reserved_by = $2)
        RETURNING id_bill, line_digits, bill_kind, amount_cents, due_date, beneficiary, reserved_until`,
      [id_bill, id_user, minutes]
    );
    return r.rows[0] || null;
  }

  static async release(conn, id_bill, id_user) {
    const r = await conn.query(
      `UPDATE public.tb_debt_bill
          SET reserved_by = NULL, reserved_until = NULL, updated_at = NOW()
        WHERE id_bill = $1 AND reserved_by = $2 AND status = 'open'
        RETURNING id_bill`,
      [id_bill, id_user]
    );
    return r.rowCount > 0;
  }

  static async claim(conn, id_bill, id_user, proof_key) {
    const r = await conn.query(
      `UPDATE public.tb_debt_bill
          SET status = 'claimed', paid_by = $2, proof_key = $3, proof_at = NOW(),
              reserved_until = NULL, updated_at = NOW()
        WHERE id_bill = $1 AND status = 'open'
          AND reserved_by = $2 AND reserved_until > NOW()
        RETURNING id_bill, id_user, amount_cents, beneficiary, status`,
      [id_bill, id_user, proof_key]
    );
    return r.rows[0] || null;
  }

  static async confirm(conn, id_bill, owner) {
    const r = await conn.query(
      `UPDATE public.tb_debt_bill
          SET status = 'paid', confirmed_at = NOW(), proof_key = NULL,
              proof_purged_at = CASE WHEN proof_key IS NULL THEN proof_purged_at ELSE NOW() END,
              reserved_by = NULL, updated_at = NOW()
        WHERE id_bill = $1 AND id_user = $2 AND status = 'claimed'
        RETURNING id_bill, id_user, paid_by, amount_cents, beneficiary`,
      [id_bill, owner]
    );
    return r.rows[0] || null;
  }

  static async rejectProof(conn, id_bill, owner) {
    const r = await conn.query(
      `UPDATE public.tb_debt_bill
          SET status = 'open', paid_by = NULL, proof_key = NULL, proof_purged_at = NOW(),
              reserved_by = NULL, reserved_until = NULL, proof_at = NULL, updated_at = NOW()
        WHERE id_bill = $1 AND id_user = $2 AND status = 'claimed'
        RETURNING id_bill`,
      [id_bill, owner]
    );
    return r.rowCount > 0;
  }

  static async cancel(conn, id_bill, owner) {
    const r = await conn.query(
      `UPDATE public.tb_debt_bill
          SET status = 'canceled', reserved_by = NULL, reserved_until = NULL, updated_at = NOW()
        WHERE id_bill = $1 AND id_user = $2 AND status IN ('review', 'open')
        RETURNING id_bill`,
      [id_bill, owner]
    );
    return r.rowCount > 0;
  }

  static async report(conn, id_bill, id_reporter, reason) {
    const r = await conn.query(
      `INSERT INTO public.tb_debt_report (id_bill, id_reporter, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_bill, id_reporter) DO NOTHING
       RETURNING id_report`,
      [id_bill, id_reporter, reason]
    );
    return r.rowCount > 0;
  }

  /* ------------------------------ leitura -------------------------------- */

  /**
   * O feed. `id_community` NULL = Brasil todo. Com comunidade e
   * `participantsOnly`, só boletos de quem participa dela (membro ou líder).
   */
  static async listFeed(conn, { viewer, id_community = null, participantsOnly = false, limit = 30, offset = 0 }) {
    const vals = [viewer || null, Math.min(60, Math.max(1, Number(limit) || 30)), Math.max(0, Number(offset) || 0)];
    let scope = "";
    if (id_community && participantsOnly) {
      vals.push(id_community);
      scope = `AND (
        EXISTS (SELECT 1 FROM public.tb_community_member m
                 WHERE m.id_community_profile = $${vals.length} AND m.id_user = b.id_user)
        OR EXISTS (SELECT 1 FROM public.tb_profile cp
                    WHERE cp.id_profile = $${vals.length} AND cp.id_leader_user = b.id_user)
      )`;
    }
    const r = await conn.query(
      `SELECT ${PUBLIC_COLS},
              (b.reserved_by IS NOT NULL AND b.reserved_until > NOW()) AS reserved,
              (b.reserved_by = $1 AND b.reserved_until > NOW())         AS reserved_by_me,
              (b.id_user = $1)                                         AS mine
         FROM public.tb_debt_bill b
         JOIN public.tb_user u ON u.id_user = b.id_user
        WHERE b.status = 'open'
          AND b.due_date >= ${TODAY_SQL}
          AND u.needs_debt_help = TRUE
          AND (SELECT COUNT(*) FROM public.tb_debt_report dr
                WHERE dr.id_bill = b.id_bill AND dr.resolved_at IS NULL) < ${REPORT_HIDE}
          ${scope}
        ORDER BY b.due_date ASC, b.id_bill ASC
        LIMIT $2 OFFSET $3`,
      vals
    );
    return r.rows;
  }

  static async listMine(conn, id_user) {
    const r = await conn.query(
      `SELECT b.id_bill, b.bill_kind, b.amount_cents, b.due_date, b.beneficiary, b.status,
              b.line_digits, b.removed_reason, b.created_at, b.confirmed_at,
              (b.due_date < ${TODAY_SQL}) AS expired,
              (b.reserved_by IS NOT NULL AND b.reserved_until > NOW()) AS reserved,
              (b.proof_key IS NOT NULL) AS has_proof
         FROM public.tb_debt_bill b
        WHERE b.id_user = $1
        ORDER BY b.created_at DESC
        LIMIT 50`,
      [id_user]
    );
    return r.rows;
  }

  /** O que eu reservei e ainda não confirmei: é onde eu acho a linha. */
  static async listHelping(conn, id_user) {
    const r = await conn.query(
      `SELECT b.id_bill, b.bill_kind, b.amount_cents, b.due_date, b.beneficiary, b.status,
              CASE WHEN b.status = 'open' THEN b.line_digits END AS line_digits,
              b.reserved_until
         FROM public.tb_debt_bill b
        WHERE (b.status = 'open' AND b.reserved_by = $1 AND b.reserved_until > NOW())
           OR (b.status IN ('claimed', 'paid') AND b.paid_by = $1)
        ORDER BY b.updated_at DESC
        LIMIT 30`,
      [id_user]
    );
    return r.rows;
  }

  static async helpedCount(conn, id_user) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_debt_bill WHERE paid_by = $1 AND status = 'paid'`,
      [id_user]
    );
    return r.rows[0]?.n || 0;
  }

  /** O par (quem ajudou, quem foi ajudado) já rendeu Esmeralda antes? */
  static async pairRewarded(conn, helper, owner, except_bill) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_debt_bill
        WHERE paid_by = $1 AND id_user = $2 AND status = 'paid' AND id_bill <> $3
        LIMIT 1`,
      [helper, owner, except_bill]
    );
    return r.rowCount > 0;
  }

  /* ------------------------------ moderação ------------------------------ */

  static async listQueue(conn) {
    const r = await conn.query(
      `SELECT b.id_bill, b.id_user, b.bill_kind, b.amount_cents, b.due_date, b.beneficiary,
              b.status, b.line_digits, b.created_at, (b.proof_key IS NOT NULL) AS has_proof,
              (b.due_date < ${TODAY_SQL}) AS expired,
              u.nome AS owner_name, u.username AS owner_username,
              COALESCE(rep.reports, '[]'::json) AS reports
         FROM public.tb_debt_bill b
         JOIN public.tb_user u ON u.id_user = b.id_user
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object('id_report', dr.id_report, 'reason', dr.reason,
                                             'created_at', dr.created_at) ORDER BY dr.created_at) AS reports
             FROM public.tb_debt_report dr
            WHERE dr.id_bill = b.id_bill AND dr.resolved_at IS NULL
         ) rep ON TRUE
        WHERE b.status = 'review'
           OR (b.status IN ('open', 'claimed') AND rep.reports IS NOT NULL)
        ORDER BY (b.status = 'review') DESC, b.created_at ASC
        LIMIT 100`
    );
    return r.rows;
  }

  static async review(conn, id_bill, { approve, beneficiary, reason }, id_admin) {
    const r = await conn.query(
      `UPDATE public.tb_debt_bill
          SET status = CASE WHEN $2 THEN 'open' ELSE 'removed' END,
              beneficiary = COALESCE($3, beneficiary),
              removed_reason = CASE WHEN $2 THEN NULL ELSE $4 END,
              reviewed_by = $5, reviewed_at = NOW(), updated_at = NOW()
        WHERE id_bill = $1 AND status = 'review'
        RETURNING id_bill, id_user, status`,
      [id_bill, !!approve, beneficiary || null, reason || null, id_admin]
    );
    return r.rows[0] || null;
  }

  static async remove(conn, id_bill, reason, id_admin) {
    const r = await conn.query(
      `UPDATE public.tb_debt_bill
          SET status = 'removed', removed_reason = $2, reserved_by = NULL, reserved_until = NULL,
              reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
        WHERE id_bill = $1 AND status IN ('review', 'open', 'claimed')
        RETURNING id_bill, id_user, proof_key`,
      [id_bill, reason || null, id_admin]
    );
    return r.rows[0] || null;
  }

  static async resolveReports(conn, id_bill, id_admin) {
    const r = await conn.query(
      `UPDATE public.tb_debt_report
          SET resolved_at = NOW(), resolved_by = $2
        WHERE id_bill = $1 AND resolved_at IS NULL`,
      [id_bill, id_admin]
    );
    return r.rowCount;
  }

  static async clearProofKey(conn, id_bill) {
    await conn.query(
      `UPDATE public.tb_debt_bill SET proof_key = NULL, proof_purged_at = NOW() WHERE id_bill = $1`,
      [id_bill]
    );
  }
}

DebtStorage.REPORT_HIDE = REPORT_HIDE;
module.exports = DebtStorage;
