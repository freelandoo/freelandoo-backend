// src/storages/AtendimentoIaStorage.js
// SQL puro do Atendimento IA (mig 175): planos, assinaturas e estado de
// provisionamento do bot.

class AtendimentoIaStorage {
  // ─── Planos ──────────────────────────────────────────────────────────────
  static async listPlans(conn, { onlyActive = true } = {}) {
    const { rows } = await conn.query(
      `SELECT id_plan, name, description, monthly_cents, token_limit_monthly,
              sort_order, is_active, created_at, updated_at
         FROM public.tb_atendimento_ia_plan
        WHERE ($1::boolean = FALSE OR is_active = TRUE)
        ORDER BY sort_order ASC, id_plan ASC`,
      [onlyActive]
    );
    return rows;
  }

  static async getPlan(conn, id_plan) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_atendimento_ia_plan WHERE id_plan = $1 LIMIT 1`,
      [id_plan]
    );
    return rows[0] || null;
  }

  static async createPlan(conn, { name, description, monthly_cents, token_limit_monthly, sort_order }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_atendimento_ia_plan
         (name, description, monthly_cents, token_limit_monthly, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, description || null, monthly_cents, token_limit_monthly, sort_order || 0]
    );
    return rows[0];
  }

  static async updatePlan(conn, id_plan, fields) {
    const sets = ["updated_at = NOW()"];
    const vals = [];
    let i = 1;
    for (const key of ["name", "description", "monthly_cents", "token_limit_monthly", "sort_order", "is_active"]) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = $${i++}`);
        vals.push(fields[key]);
      }
    }
    vals.push(id_plan);
    const { rows } = await conn.query(
      `UPDATE public.tb_atendimento_ia_plan SET ${sets.join(", ")}
        WHERE id_plan = $${i} RETURNING *`,
      vals
    );
    return rows[0] || null;
  }

  // ─── Assinatura ──────────────────────────────────────────────────────────
  static async createPendingSub(conn, { id_user, id_plan, monthly_cents, token_limit_monthly }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_atendimento_ia_sub
         (id_user, id_plan, monthly_cents, token_limit_monthly)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [id_user, id_plan, monthly_cents, token_limit_monthly]
    );
    return rows[0];
  }

  static async setSubSession(conn, id_sub, session_id) {
    await conn.query(
      `UPDATE public.tb_atendimento_ia_sub
          SET stripe_session_id = $2, updated_at = NOW()
        WHERE id_sub = $1`,
      [id_sub, session_id]
    );
  }

  static async getSubById(conn, id_sub) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_atendimento_ia_sub WHERE id_sub = $1 LIMIT 1`,
      [id_sub]
    );
    return rows[0] || null;
  }

  static async getLiveSubByUser(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_atendimento_ia_sub
        WHERE id_user = $1 AND status IN ('pending','active','past_due')
        LIMIT 1`,
      [id_user]
    );
    return rows[0] || null;
  }

  static async getSubBySession(conn, session_id) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_atendimento_ia_sub WHERE stripe_session_id = $1 LIMIT 1`,
      [session_id]
    );
    return rows[0] || null;
  }

  static async getSubBySubscriptionId(conn, subscription_id) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_atendimento_ia_sub WHERE stripe_subscription_id = $1 LIMIT 1`,
      [subscription_id]
    );
    return rows[0] || null;
  }

  static async activateSub(conn, id_sub, { stripe_subscription_id, stripe_customer_id }) {
    await conn.query(
      `UPDATE public.tb_atendimento_ia_sub
          SET status = 'active',
              activated_at = COALESCE(activated_at, NOW()),
              stripe_subscription_id = COALESCE($2, stripe_subscription_id),
              stripe_customer_id = COALESCE($3, stripe_customer_id),
              updated_at = NOW()
        WHERE id_sub = $1`,
      [id_sub, stripe_subscription_id || null, stripe_customer_id || null]
    );
  }

  static async setStatusBySubscriptionId(conn, subscription_id, status) {
    await conn.query(
      `UPDATE public.tb_atendimento_ia_sub
          SET status = $2, updated_at = NOW()
        WHERE stripe_subscription_id = $1
          AND status IN ('pending','active','past_due')`,
      [subscription_id, status]
    );
  }

  static async markSubCanceled(conn, id_sub) {
    await conn.query(
      `UPDATE public.tb_atendimento_ia_sub
          SET status = 'canceled', canceled_at = COALESCE(canceled_at, NOW()), updated_at = NOW()
        WHERE id_sub = $1 AND status <> 'canceled'`,
      [id_sub]
    );
  }

  static async markSubExpiredBySession(conn, session_id) {
    const { rows } = await conn.query(
      `UPDATE public.tb_atendimento_ia_sub
          SET status = 'expired', updated_at = NOW()
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING id_sub`,
      [session_id]
    );
    return rows.length > 0;
  }

  static async setPeriod(conn, id_sub, { period_start, period_end }) {
    await conn.query(
      `UPDATE public.tb_atendimento_ia_sub
          SET current_period_start = $2, current_period_end = $3, updated_at = NOW()
        WHERE id_sub = $1`,
      [id_sub, period_start || null, period_end || null]
    );
  }

  static async setConnections(conn, id_sub, { id_connection_atendimento, id_connection_data }) {
    await conn.query(
      `UPDATE public.tb_atendimento_ia_sub
          SET id_connection_atendimento = $2, id_connection_data = $3, updated_at = NOW()
        WHERE id_sub = $1`,
      [id_sub, id_connection_atendimento || null, id_connection_data || null]
    );
  }

  static async setConfig(conn, id_sub, config) {
    const { rows } = await conn.query(
      `UPDATE public.tb_atendimento_ia_sub
          SET config = $2::jsonb, updated_at = NOW()
        WHERE id_sub = $1 RETURNING config`,
      [id_sub, JSON.stringify(config)]
    );
    return rows[0]?.config || null;
  }

  // Estado do provisionamento (retry com backoff pelo sweeper).
  static async setProvisioning(conn, id_sub, { status, attempts, next_attempt_at, last_error }) {
    await conn.query(
      `UPDATE public.tb_atendimento_ia_sub
          SET provisioning_status = $2,
              provision_attempts = COALESCE($3, provision_attempts),
              next_provision_attempt_at = $4,
              provision_last_error = $5,
              updated_at = NOW()
        WHERE id_sub = $1`,
      [id_sub, status, attempts ?? null, next_attempt_at || null,
       last_error ? String(last_error).slice(0, 500) : null]
    );
  }

  static async listDueForProvision(conn, limit = 10) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_atendimento_ia_sub
        WHERE status IN ('active','past_due')
          AND provisioning_status IN ('pending','failed')
          AND (next_provision_attempt_at IS NULL OR next_provision_attempt_at <= NOW())
        ORDER BY next_provision_attempt_at ASC NULLS FIRST
        LIMIT $1`,
      [limit]
    );
    return rows;
  }

  // ─── Admin ───────────────────────────────────────────────────────────────
  static async listSubsAdmin(conn, { status, limit = 100 } = {}) {
    const { rows } = await conn.query(
      `SELECT s.*, u.username, u.nome AS user_name, p.name AS plan_name
         FROM public.tb_atendimento_ia_sub s
         JOIN public.tb_user u ON u.id_user = s.id_user
         LEFT JOIN public.tb_atendimento_ia_plan p ON p.id_plan = s.id_plan
        WHERE ($1::varchar IS NULL OR s.status = $1)
        ORDER BY s.created_at DESC
        LIMIT $2`,
      [status || null, Math.min(Number(limit) || 100, 500)]
    );
    return rows;
  }
}

module.exports = AtendimentoIaStorage;
