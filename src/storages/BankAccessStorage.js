// src/storages/BankAccessStorage.js
//
// A ASSINATURA DOS BANCOS CONECTADOS (mig 462). Cópia deliberada da mecânica do
// acesso verificado (VerificationStorage, mig 268): cartão = assinatura que
// empurra `paid_until` a cada fatura; Pix = um mês. SQL puro — as regras moram
// no BankAccessService. Quem decide "pode conectar?" é `bankAccessSql`.

/**
 * Pode usar os bancos conectados = pagou e está no período OU é administrador
 * (o admin testa antes de abrir ao público, como no acesso).
 * @param {string} userIdExpr expressão de COLUNA escrita no código (interpolada).
 */
function bankAccessSql(userIdExpr) {
  if (!/^[a-z_][a-z0-9_]*.[a-z_][a-z0-9_]*$/i.test(String(userIdExpr))) {
    throw new Error(`bankAccessSql: expressão de coluna inválida: ${userIdExpr}`);
  }
  return `(
    EXISTS (SELECT 1 FROM public.tb_user_bank_access ba_
             WHERE ba_.id_user = ${userIdExpr} AND ba_.paid_until > NOW())
    OR EXISTS (SELECT 1 FROM public.tb_user_role ur_
                 JOIN public.tb_role r_ ON r_.id_role = ur_.id_role
                WHERE ur_.id_user = ${userIdExpr} AND ur_.is_active = TRUE
                  AND r_.is_active = TRUE AND r_.desc_role = 'Administrator')
  )`;
}

class BankAccessStorage {
  /** A régua vigente. Sem a linha, o seed (R$ 20, 2 bancos) — nunca "de graça". */
  static async getSettings(conn) {
    try {
      const r = await conn.query(
        `SELECT monthly_cents, is_active, max_banks, connects_per_month
           FROM public.tb_bank_access_settings WHERE id = 1`
      );
      if (r.rows[0]) {
        return {
          monthly_cents: Math.max(0, Math.round(Number(r.rows[0].monthly_cents) || 0)),
          is_active: r.rows[0].is_active !== false,
          max_banks: Number(r.rows[0].max_banks) || 2,
          connects_per_month: Number(r.rows[0].connects_per_month) || 3,
        };
      }
    } catch {
      /* banco sem a tabela: cai no seed */
    }
    return { monthly_cents: 2000, is_active: true, max_banks: 2, connects_per_month: 3 };
  }

  static async updateSettings(conn, { monthly_cents, is_active, max_banks, connects_per_month, updated_by }) {
    const r = await conn.query(
      `UPDATE public.tb_bank_access_settings
          SET monthly_cents      = COALESCE($1, monthly_cents),
              is_active          = COALESCE($2, is_active),
              max_banks          = COALESCE($4, max_banks),
              connects_per_month = COALESCE($5, connects_per_month),
              updated_at         = NOW(),
              updated_by         = $3
        WHERE id = 1
        RETURNING monthly_cents, is_active, max_banks, connects_per_month`,
      [monthly_cents ?? null, is_active ?? null, updated_by ?? null, max_banks ?? null, connects_per_month ?? null]
    );
    return r.rows[0] || null;
  }

  /**
   * O estado do acesso de uma pessoa, com a MESMA régua de `bankAccessSql`.
   * `is_admin` sai separado para a tela explicar por que o acesso está lá.
   */
  static async getStatus(conn, id_user) {
    const r = await conn.query(
      `SELECT u.id_user,
              v.paid_until,
              v.subscription_ref,
              v.subscription_status,
              ${bankAccessSql("u.id_user")} AS has_access,
              EXISTS (
                SELECT 1 FROM public.tb_user_role ur
                  JOIN public.tb_role r ON r.id_role = ur.id_role
                 WHERE ur.id_user = u.id_user AND ur.is_active = TRUE
                   AND r.is_active = TRUE AND r.desc_role = 'Administrator'
              ) AS is_admin
         FROM public.tb_user u
         LEFT JOIN public.tb_user_bank_access v ON v.id_user = u.id_user
        WHERE u.id_user = $1`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  static async getByUser(conn, id_user) {
    const r = await conn.query(
      `SELECT * FROM public.tb_user_bank_access WHERE id_user = $1`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  static async getBySubscriptionRef(conn, ref) {
    const r = await conn.query(
      `SELECT * FROM public.tb_user_bank_access WHERE subscription_ref = $1 LIMIT 1`,
      [ref]
    );
    return r.rows[0] || null;
  }

  /**
   * Empurra o acesso N meses.
   *
   * ⚠️ `GREATEST(paid_until, NOW())` é o coração, e errar custa nos dois
   * sentidos: sempre a partir de NOW(), quem renova faltando 20 dias PERDE os
   * 20; sempre a partir de paid_until, quem volta meses depois GANHA o tempo em
   * que esteve fora. (A mesma conta da vitrine, mig 252.)
   */
  static async extendPaidUntil(conn, id_user, months = 1) {
    const r = await conn.query(
      `INSERT INTO public.tb_user_bank_access (id_user, paid_until)
       VALUES ($1, NOW() + ($2::int * INTERVAL '1 month'))
       ON CONFLICT (id_user) DO UPDATE
          SET paid_until = GREATEST(COALESCE(tb_user_bank_access.paid_until, NOW()), NOW())
                           + ($2::int * INTERVAL '1 month'),
              updated_at = NOW()
       RETURNING id_user, paid_until`,
      [id_user, Math.max(1, Math.round(Number(months) || 1))]
    );
    return r.rows[0] || null;
  }

  /**
   * Devolve o tempo que uma cobrança estornada comprou.
   *
   * ⚠️ MÉTODO PRÓPRIO, e não `extendPaidUntil(-1)`: aquele fixa o mínimo em 1
   * mês, e o estorno daria trinta dias de graça a quem recebeu o dinheiro de
   * volta (a lição da mig 252).
   */
  static async shrinkPaidUntil(conn, id_user, months = 1) {
    const r = await conn.query(
      `UPDATE public.tb_user_bank_access
          SET paid_until = paid_until - ($2::int * INTERVAL '1 month'),
              updated_at = NOW()
        WHERE id_user = $1 AND paid_until IS NOT NULL
        RETURNING id_user, paid_until`,
      [id_user, Math.max(1, Math.round(Number(months) || 1))]
    );
    return r.rows[0] || null;
  }

  static async attachSubscription(conn, id_user, { ref, provider, status = "past_due" }) {
    const r = await conn.query(
      `INSERT INTO public.tb_user_bank_access
         (id_user, subscription_ref, subscription_provider, subscription_status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id_user) DO UPDATE
          SET subscription_ref      = EXCLUDED.subscription_ref,
              subscription_provider = EXCLUDED.subscription_provider,
              subscription_status   = EXCLUDED.subscription_status,
              updated_at            = NOW()
       RETURNING *`,
      [id_user, ref, provider ?? null, status]
    );
    return r.rows[0] || null;
  }

  static async setSubscriptionStatus(conn, id_user, status) {
    await conn.query(
      `UPDATE public.tb_user_bank_access
          SET subscription_status = $2, updated_at = NOW()
        WHERE id_user = $1`,
      [id_user, status]
    );
  }

  /** Solta a renovação. O período já pago continua valendo. */
  static async detachSubscription(conn, id_user) {
    const r = await conn.query(
      `UPDATE public.tb_user_bank_access
          SET subscription_ref = NULL,
              subscription_provider = NULL,
              subscription_status = 'canceled',
              updated_at = NOW()
        WHERE id_user = $1
        RETURNING *`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  /* ─────────────────────────────── cobranças ─────────────────────────────── */

  static async createPayment(conn, { id_user, method, payment_provider, amount_cents, stripe_session_id }) {
    const r = await conn.query(
      `INSERT INTO public.tb_bank_access_payment
         (id_user, method, payment_provider, amount_cents, stripe_session_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id_user, method, payment_provider ?? null, amount_cents || 0, stripe_session_id ?? null]
    );
    return r.rows[0];
  }

  static async markPaymentPaid(conn, stripe_session_id, payment_intent_id = null) {
    const r = await conn.query(
      `UPDATE public.tb_bank_access_payment
          SET status = 'paid',
              paid_at = NOW(),
              payment_intent_id = COALESCE($2, payment_intent_id),
              updated_at = NOW()
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING *`,
      [stripe_session_id, payment_intent_id]
    );
    return r.rows[0] || null;
  }

  static async getPaymentBySession(conn, stripe_session_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_bank_access_payment WHERE stripe_session_id = $1 LIMIT 1`,
      [stripe_session_id]
    );
    return r.rows[0] || null;
  }

  static async getPaymentByPaymentIntent(conn, payment_intent_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_bank_access_payment WHERE payment_intent_id = $1 LIMIT 1`,
      [payment_intent_id]
    );
    return r.rows[0] || null;
  }

  static async markPaymentCanceled(conn, stripe_session_id) {
    const r = await conn.query(
      `UPDATE public.tb_bank_access_payment
          SET status = 'canceled', updated_at = NOW()
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING id_payment`,
      [stripe_session_id]
    );
    return r.rowCount > 0;
  }

  static async markPaymentRefunded(conn, id_payment) {
    const r = await conn.query(
      `UPDATE public.tb_bank_access_payment
          SET status = 'refunded', refunded_at = NOW(), updated_at = NOW()
        WHERE id_payment = $1 AND refunded_at IS NULL
        RETURNING *`,
      [id_payment]
    );
    return r.rows[0] || null;
  }

  static async setPaymentPeriod(conn, id_payment, { period_start, period_end }) {
    await conn.query(
      `UPDATE public.tb_bank_access_payment
          SET period_start = $2, period_end = $3, updated_at = NOW()
        WHERE id_payment = $1`,
      [id_payment, period_start ?? null, period_end ?? null]
    );
  }

  /**
   * A renovação mensal, deduplicada pela fatura.
   *
   * ⚠️ O webhook é at-least-once: sem o UNIQUE de `invoice_ref`, cada
   * re-entrega empurraria o acesso mais um mês de graça.
   */
  static async recordRenewalOnce(conn, { id_user, payment_provider, amount_cents, invoice_ref, payment_intent_id }) {
    const r = await conn.query(
      `INSERT INTO public.tb_bank_access_payment
         (id_user, method, payment_provider, amount_cents, status, invoice_ref,
          payment_intent_id, paid_at)
       VALUES ($1, 'renewal', $2, $3, 'paid', $4, $5, NOW())
       ON CONFLICT (invoice_ref) WHERE invoice_ref IS NOT NULL DO NOTHING
       RETURNING *`,
      [id_user, payment_provider ?? null, amount_cents || 0, invoice_ref, payment_intent_id ?? null]
    );
    return r.rows[0] || null;
  }
}

module.exports = BankAccessStorage;
module.exports.bankAccessSql = bankAccessSql;
