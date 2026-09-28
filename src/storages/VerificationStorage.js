// src/storages/VerificationStorage.js
//
// O SELO VERIFICADO (mig 268). SQL puro — as regras moram no
// VerificationService; quem decide "está verificado?" é `utils/verifiedBadge`.

const { verifiedUserSql } = require("../utils/verifiedBadge");

class VerificationStorage {
  /** A régua vigente. Sem a linha, R$9,90 (o seed) — nunca "de graça". */
  static async getSettings(conn) {
    try {
      const r = await conn.query(
        `SELECT monthly_cents, is_active FROM public.tb_verification_settings WHERE id = 1`
      );
      if (r.rows[0]) {
        return {
          monthly_cents: Math.max(0, Math.round(Number(r.rows[0].monthly_cents) || 0)),
          is_active: r.rows[0].is_active !== false,
        };
      }
    } catch {
      /* banco sem a tabela: cai no seed */
    }
    return { monthly_cents: 990, is_active: true };
  }

  static async updateSettings(conn, { monthly_cents, is_active, updated_by }) {
    const r = await conn.query(
      `UPDATE public.tb_verification_settings
          SET monthly_cents = COALESCE($1, monthly_cents),
              is_active     = COALESCE($2, is_active),
              updated_at    = NOW(),
              updated_by    = $3
        WHERE id = 1
        RETURNING monthly_cents, is_active`,
      [monthly_cents ?? null, is_active ?? null, updated_by ?? null]
    );
    return r.rows[0] || null;
  }

  /**
   * O estado do selo de uma pessoa, com a MESMA régua das projeções: pagou ou é
   * admin. `is_admin` sai separado para a tela explicar por que o selo está lá.
   */
  static async getStatus(conn, id_user) {
    const r = await conn.query(
      `SELECT u.id_user,
              v.paid_until,
              v.subscription_ref,
              v.subscription_status,
              ${verifiedUserSql("u.id_user")} AS is_verified,
              EXISTS (
                SELECT 1 FROM public.tb_user_role ur
                  JOIN public.tb_role r ON r.id_role = ur.id_role
                 WHERE ur.id_user = u.id_user AND ur.is_active = TRUE
                   AND r.is_active = TRUE AND r.desc_role = 'Administrator'
              ) AS is_admin
         FROM public.tb_user u
         LEFT JOIN public.tb_user_verification v ON v.id_user = u.id_user
        WHERE u.id_user = $1`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  static async getByUser(conn, id_user) {
    const r = await conn.query(
      `SELECT * FROM public.tb_user_verification WHERE id_user = $1`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  static async getBySubscriptionRef(conn, ref) {
    const r = await conn.query(
      `SELECT * FROM public.tb_user_verification WHERE subscription_ref = $1 LIMIT 1`,
      [ref]
    );
    return r.rows[0] || null;
  }

  /**
   * Empurra o selo N meses.
   *
   * ⚠️ `GREATEST(paid_until, NOW())` é o coração, e errar custa nos dois
   * sentidos: sempre a partir de NOW(), quem renova faltando 20 dias PERDE os
   * 20; sempre a partir de paid_until, quem volta meses depois GANHA o tempo em
   * que esteve fora. (A mesma conta da vitrine, mig 252.)
   */
  static async extendPaidUntil(conn, id_user, months = 1) {
    const r = await conn.query(
      `INSERT INTO public.tb_user_verification (id_user, paid_until)
       VALUES ($1, NOW() + ($2::int * INTERVAL '1 month'))
       ON CONFLICT (id_user) DO UPDATE
          SET paid_until = GREATEST(COALESCE(tb_user_verification.paid_until, NOW()), NOW())
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
      `UPDATE public.tb_user_verification
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
      `INSERT INTO public.tb_user_verification
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
      `UPDATE public.tb_user_verification
          SET subscription_status = $2, updated_at = NOW()
        WHERE id_user = $1`,
      [id_user, status]
    );
  }

  /** Solta a renovação. O período já pago continua valendo. */
  static async detachSubscription(conn, id_user) {
    const r = await conn.query(
      `UPDATE public.tb_user_verification
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
      `INSERT INTO public.tb_user_verification_payment
         (id_user, method, payment_provider, amount_cents, stripe_session_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id_user, method, payment_provider ?? null, amount_cents || 0, stripe_session_id ?? null]
    );
    return r.rows[0];
  }

  static async markPaymentPaid(conn, stripe_session_id, payment_intent_id = null) {
    const r = await conn.query(
      `UPDATE public.tb_user_verification_payment
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
      `SELECT * FROM public.tb_user_verification_payment WHERE stripe_session_id = $1 LIMIT 1`,
      [stripe_session_id]
    );
    return r.rows[0] || null;
  }

  static async getPaymentByPaymentIntent(conn, payment_intent_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_user_verification_payment WHERE payment_intent_id = $1 LIMIT 1`,
      [payment_intent_id]
    );
    return r.rows[0] || null;
  }

  static async markPaymentCanceled(conn, stripe_session_id) {
    const r = await conn.query(
      `UPDATE public.tb_user_verification_payment
          SET status = 'canceled', updated_at = NOW()
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING id_payment`,
      [stripe_session_id]
    );
    return r.rowCount > 0;
  }

  static async markPaymentRefunded(conn, id_payment) {
    const r = await conn.query(
      `UPDATE public.tb_user_verification_payment
          SET status = 'refunded', refunded_at = NOW(), updated_at = NOW()
        WHERE id_payment = $1 AND refunded_at IS NULL
        RETURNING *`,
      [id_payment]
    );
    return r.rows[0] || null;
  }

  static async setPaymentPeriod(conn, id_payment, { period_start, period_end }) {
    await conn.query(
      `UPDATE public.tb_user_verification_payment
          SET period_start = $2, period_end = $3, updated_at = NOW()
        WHERE id_payment = $1`,
      [id_payment, period_start ?? null, period_end ?? null]
    );
  }

  /**
   * A renovação mensal, deduplicada pela fatura.
   *
   * ⚠️ O webhook é at-least-once: sem o UNIQUE de `invoice_ref`, cada
   * re-entrega empurraria o selo mais um mês de graça.
   */
  static async recordRenewalOnce(conn, { id_user, payment_provider, amount_cents, invoice_ref, payment_intent_id }) {
    const r = await conn.query(
      `INSERT INTO public.tb_user_verification_payment
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

module.exports = VerificationStorage;
