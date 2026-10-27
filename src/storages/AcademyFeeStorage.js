// src/storages/AcademyFeeStorage.js
// Mensalidade paga pela Freelandoo (mig 310): régua, conta de recebimento,
// pedido (checkout), repasse e a baixa/reabertura na API da academia.
module.exports = {
  // ─── Régua ─────────────────────────────────────────────────────────────────
  async getSettings(db) {
    const r = await db.query(`SELECT * FROM public.tb_academy_fee_settings WHERE id = 1`);
    const row = r.rows[0] || {};
    return {
      platform_fee_cents: Number.isFinite(Number(row.platform_fee_cents)) ? Number(row.platform_fee_cents) : 250,
      holdback_days: Number.isFinite(Number(row.holdback_days)) ? Number(row.holdback_days) : 8,
      is_active: row.is_active !== false,
    };
  },

  // ─── Conta de recebimento ─────────────────────────────────────────────────
  async getAccount(db, id_academy) {
    const r = await db.query(
      `SELECT * FROM public.tb_academy_payout_account WHERE id_academy = $1`,
      [id_academy]
    );
    return r.rows[0] || null;
  },

  async upsertAccount(db, a) {
    const r = await db.query(
      `INSERT INTO public.tb_academy_payout_account
         (id_academy, pix_key_type, pix_key_sealed, pix_key_hint, holder_name,
          holder_doc_type, holder_doc_sealed, holder_doc_hint, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id_academy) DO UPDATE SET
         pix_key_type = EXCLUDED.pix_key_type,
         pix_key_sealed = EXCLUDED.pix_key_sealed,
         pix_key_hint = EXCLUDED.pix_key_hint,
         holder_name = EXCLUDED.holder_name,
         holder_doc_type = EXCLUDED.holder_doc_type,
         holder_doc_sealed = EXCLUDED.holder_doc_sealed,
         holder_doc_hint = EXCLUDED.holder_doc_hint,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING *`,
      [
        a.id_academy,
        a.pix_key_type,
        a.pix_key_sealed,
        a.pix_key_hint,
        a.holder_name,
        a.holder_doc_type,
        a.holder_doc_sealed,
        a.holder_doc_hint,
        a.updated_by || null,
      ]
    );
    return r.rows[0];
  },

  async deleteAccount(db, id_academy) {
    await db.query(`DELETE FROM public.tb_academy_payout_account WHERE id_academy = $1`, [id_academy]);
  },

  // ─── Pedido ────────────────────────────────────────────────────────────────
  /**
   * Nasce ANTES da ida ao gateway. O índice único parcial
   * (`ux_academy_fee_order_open`) é a trava contra o duplo clique: o segundo
   * INSERT da mesma cobrança volta `null` aqui, e o service devolve o checkout
   * do primeiro em vez de abrir outro.
   */
  async createOrder(db, o) {
    const r = await db.query(
      `INSERT INTO public.tb_academy_fee_order
         (id_academy, id_member, id_user, external_id, due_date, amount_cents,
          platform_fee_cents, processor_fee_cents, processor_fee_source, net_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        o.id_academy,
        o.id_member,
        o.id_user,
        o.external_id,
        o.due_date || null,
        o.amount_cents,
        o.platform_fee_cents,
        o.processor_fee_cents,
        o.processor_fee_source,
        o.net_cents,
      ]
    );
    return r.rows[0] || null;
  },

  async getOpenOrder(db, id_academy, external_id) {
    const r = await db.query(
      `SELECT * FROM public.tb_academy_fee_order
        WHERE id_academy = $1 AND external_id = $2 AND status IN ('pending', 'paid')
        LIMIT 1`,
      [id_academy, external_id]
    );
    return r.rows[0] || null;
  },

  async attachCharge(db, id_order, { provider, session_id, provider_ref, checkout_url }) {
    const r = await db.query(
      `UPDATE public.tb_academy_fee_order
          SET payment_provider = $2, session_id = $3, provider_ref = $4,
              checkout_url = $5, updated_at = NOW()
        WHERE id_order = $1
        RETURNING *`,
      [id_order, provider, session_id, provider_ref, checkout_url ?? null]
    );
    return r.rows[0] || null;
  },

  async cancelById(db, id_order) {
    const r = await db.query(
      `UPDATE public.tb_academy_fee_order
          SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
        WHERE id_order = $1 AND status = 'pending'
        RETURNING *`,
      [id_order]
    );
    return r.rows[0] || null;
  },

  async cancelBySession(db, session_id) {
    const r = await db.query(
      `UPDATE public.tb_academy_fee_order
          SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
        WHERE session_id = $1 AND status = 'pending'
        RETURNING *`,
      [session_id]
    );
    return r.rows[0] || null;
  },

  async markPaid(db, session_id, provider_ref = null) {
    const r = await db.query(
      `UPDATE public.tb_academy_fee_order
          SET status = 'paid', paid_at = NOW(),
              provider_ref = COALESCE($2, provider_ref), updated_at = NOW()
        WHERE session_id = $1 AND status = 'pending'
        RETURNING *`,
      [session_id, provider_ref]
    );
    return r.rows[0] || null;
  },

  async getBySession(db, session_id) {
    const r = await db.query(
      `SELECT * FROM public.tb_academy_fee_order WHERE session_id = $1 LIMIT 1`,
      [session_id]
    );
    return r.rows[0] || null;
  },

  async getByProviderRef(db, provider_ref) {
    const r = await db.query(
      `SELECT * FROM public.tb_academy_fee_order WHERE provider_ref = $1 LIMIT 1`,
      [provider_ref]
    );
    return r.rows[0] || null;
  },

  async applyProcessorFee(db, id_order, { processor_fee_cents, platform_fee_cents, net_cents }) {
    const r = await db.query(
      `UPDATE public.tb_academy_fee_order
          SET processor_fee_cents = $2, platform_fee_cents = $3, net_cents = $4,
              processor_fee_source = 'gateway', updated_at = NOW()
        WHERE id_order = $1
        RETURNING *`,
      [id_order, processor_fee_cents, platform_fee_cents, net_cents]
    );
    return r.rows[0] || null;
  },

  /** Estorno: marca o pedido; o que acontece com o repasse é decidido junto. */
  async markRefunded(db, id_order, { reopen }) {
    const r = await db.query(
      `UPDATE public.tb_academy_fee_order
          SET status = 'refunded', refunded_at = NOW(),
              academy_reopen_needed = $2, updated_at = NOW()
        WHERE id_order = $1 AND status = 'paid'
        RETURNING *`,
      [id_order, reopen === true]
    );
    return r.rows[0] || null;
  },

  /** Checkouts vivos e pagamentos ainda não espelhados, por cobrança. */
  async openOrdersForMember(db, id_member) {
    const r = await db.query(
      `SELECT external_id, status, checkout_url, paid_at
         FROM public.tb_academy_fee_order
        WHERE id_member = $1
          AND (status = 'paid' OR (status = 'pending' AND created_at > NOW() - INTERVAL '1 day'))`,
      [id_member]
    );
    return r.rows;
  },

  // ─── Baixa e reabertura na academia ───────────────────────────────────────
  /** `note`: encerra as tentativas guardando o motivo (ex.: já pago lá). */
  async markNotified(db, id_order, note = null) {
    await db.query(
      `UPDATE public.tb_academy_fee_order
          SET academy_notified_at = NOW(), academy_notify_error = $2,
              academy_notify_tries = academy_notify_tries + 1, updated_at = NOW()
        WHERE id_order = $1`,
      [id_order, note ? String(note).slice(0, 300) : null]
    );
  },

  async markNotifyFailed(db, id_order, error) {
    await db.query(
      `UPDATE public.tb_academy_fee_order
          SET academy_notify_error = $2, academy_notify_tries = academy_notify_tries + 1,
              updated_at = NOW()
        WHERE id_order = $1`,
      [id_order, String(error || "").slice(0, 300)]
    );
  },

  async markReopened(db, id_order) {
    await db.query(
      `UPDATE public.tb_academy_fee_order
          SET academy_reopened_at = NOW(), academy_reopen_needed = FALSE, updated_at = NOW()
        WHERE id_order = $1`,
      [id_order]
    );
  },

  /**
   * Pendências com a academia: baixa não confirmada (pagos sem
   * `academy_notified_at`) e reaberturas devidas. Recuo simples: a cada
   * tentativa falha, espera mais (tries × 10 min), até 2 dias de tentativas.
   */
  async listAcademyPending(db, limit = 50) {
    const r = await db.query(
      `SELECT o.*
         FROM public.tb_academy_fee_order o
        WHERE ((o.status = 'paid' AND o.academy_notified_at IS NULL)
               OR (o.status = 'refunded' AND o.academy_reopen_needed))
          AND o.academy_notify_tries < 288
          AND o.updated_at < NOW() - (LEAST(o.academy_notify_tries, 36) * INTERVAL '10 minutes')
        ORDER BY o.updated_at ASC
        LIMIT $1`,
      [limit]
    );
    return r.rows;
  },

  /** O espelho mostra "Pago via Freelandoo" já, sem esperar o sync da academia. */
  async markMirrorPaid(db, id_academy, external_id) {
    await db.query(
      `UPDATE public.tb_academy_payment
          SET status = 'paid', paid_at = COALESCE(paid_at, NOW()),
              paid_via = 'freelandoo', method = 'freelandoo', updated_at = NOW()
        WHERE id_academy = $1 AND external_id = $2`,
      [id_academy, external_id]
    );
  },

  async markMirrorReopened(db, id_academy, external_id) {
    await db.query(
      `UPDATE public.tb_academy_payment
          SET status = CASE WHEN due_date < NOW() THEN 'overdue' ELSE 'pending' END,
              paid_at = NULL, paid_via = 'academy', method = NULL, updated_at = NOW()
        WHERE id_academy = $1 AND external_id = $2 AND paid_via = 'freelandoo'`,
      [id_academy, external_id]
    );
  },

  // ─── Repasse ───────────────────────────────────────────────────────────────
  async createPayout(db, p) {
    const r = await db.query(
      `INSERT INTO public.tb_academy_payout
         (id_order, id_academy, charge_cents, platform_fee_cents, processor_fee_cents,
          net_cents, available_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id_order) DO NOTHING
       RETURNING *`,
      [
        p.id_order,
        p.id_academy,
        p.charge_cents,
        p.platform_fee_cents,
        p.processor_fee_cents,
        p.net_cents,
        p.available_at,
      ]
    );
    return r.rows[0] || null;
  },

  async getPayoutByOrder(db, id_order) {
    const r = await db.query(`SELECT * FROM public.tb_academy_payout WHERE id_order = $1`, [id_order]);
    return r.rows[0] || null;
  },

  /**
   * Estorno: antes do PIX o repasse é REVERTIDO (ninguém deve nada); depois
   * dele, vira DEVIDO — a academia recebeu um dinheiro que voltou ao aluno, e
   * quem resolve é o admin. Devolve o status final (ou null se não havia).
   */
  async reverseForRefund(db, id_order) {
    const r = await db.query(
      `UPDATE public.tb_academy_payout
          SET status = CASE WHEN status = 'pago' THEN 'devido' ELSE 'revertido' END,
              updated_at = NOW()
        WHERE id_order = $1 AND status IN ('aguardando', 'aprovado', 'pago')
        RETURNING status`,
      [id_order]
    );
    return r.rows[0]?.status || null;
  },

  async releaseDuePayouts(db, limit = 200) {
    const r = await db.query(
      `UPDATE public.tb_academy_payout
          SET status = 'aprovado', approved_at = NOW(), updated_at = NOW()
        WHERE id_payout IN (
          SELECT id_payout FROM public.tb_academy_payout
           WHERE status = 'aguardando' AND available_at <= NOW()
           ORDER BY available_at ASC
           LIMIT $1
        )
        RETURNING *`,
      [limit]
    );
    return r.rows;
  },

  async listPayoutsForAcademy(db, id_academy, limit = 100) {
    const r = await db.query(
      `SELECT p.*, o.external_id, o.due_date, o.paid_at AS charge_paid_at,
              m.member_name
         FROM public.tb_academy_payout p
         JOIN public.tb_academy_fee_order o ON o.id_order = p.id_order
         LEFT JOIN public.tb_academy_member m ON m.id_member = o.id_member
        WHERE p.id_academy = $1
        ORDER BY p.created_at DESC
        LIMIT $2`,
      [id_academy, limit]
    );
    return r.rows;
  },

  async summaryForAcademy(db, id_academy) {
    const r = await db.query(
      `SELECT
          COALESCE(SUM(net_cents) FILTER (WHERE status = 'aguardando'), 0)::int AS aguardando_cents,
          COALESCE(SUM(net_cents) FILTER (WHERE status = 'aprovado'), 0)::int   AS aprovado_cents,
          COALESCE(SUM(net_cents) FILTER (WHERE status = 'pago'), 0)::int       AS pago_cents,
          COALESCE(SUM(net_cents) FILTER (WHERE status = 'devido'), 0)::int     AS devido_cents
         FROM public.tb_academy_payout
        WHERE id_academy = $1`,
      [id_academy]
    );
    return r.rows[0];
  },

  /** A fila do admin: quem tem dinheiro a receber e para qual chave. */
  async listPayoutsAdmin(db, { status = null, limit = 100, offset = 0 } = {}) {
    const params = [];
    let where = "";
    if (status) {
      params.push(status);
      where = `WHERE p.status = $${params.length}`;
    }
    params.push(limit, offset);
    const r = await db.query(
      `SELECT p.*, a.nome AS academy_nome, a.slug AS academy_slug,
              acc.pix_key_type, acc.pix_key_sealed, acc.holder_name, acc.holder_doc_type,
              acc.holder_doc_sealed, o.external_id, o.academy_notified_at,
              o.academy_notify_error, m.member_name
         FROM public.tb_academy_payout p
         JOIN public.tb_academy a ON a.id_academy = p.id_academy
         JOIN public.tb_academy_fee_order o ON o.id_order = p.id_order
         LEFT JOIN public.tb_academy_member m ON m.id_member = o.id_member
         LEFT JOIN public.tb_academy_payout_account acc ON acc.id_academy = p.id_academy
         ${where}
        ORDER BY p.available_at ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  },

  async markPayoutPaid(db, id_payout, { note, by }) {
    const r = await db.query(
      `UPDATE public.tb_academy_payout
          SET status = 'pago', paid_out_at = NOW(), paid_out_note = $2,
              paid_out_by = $3, updated_at = NOW()
        WHERE id_payout = $1 AND status = 'aprovado'
        RETURNING *`,
      [id_payout, note ? String(note).slice(0, 300) : null, by || null]
    );
    return r.rows[0] || null;
  },
};
