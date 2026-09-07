// src/storages/PlanStorage.js
// SQL puro dos planos mensais (mig 225): o catálogo, o que cada plano inclui e
// a assinatura de cada pessoa.
//
// ─── A CONSULTA QUE IMPORTA ─────────────────────────────────────────────────
//
// `featureKeysInAnyPlan` responde "esta função é de plano?" e é ela que cria o
// terceiro estado de posse. Sem ela, `is_for_sale = FALSE` continuaria
// significando "grátis para todos" e o pacote viraria um presente para a base
// inteira.
//
// ─── ASSINATURA VIVA É `active` OU `past_due`, SEMPRE AS DUAS ───────────────
//
// Do mesmo jeito que morador é `recognized AND ended_at IS NULL`, aqui meia
// condição é um bug: quem teve uma fatura recusada e está no retry do Stripe
// continua com acesso — cortar no primeiro erro de cartão derrubaria o negócio
// de quem só trocou de banco.

const LIVE = "('active', 'past_due')";

class PlanStorage {
  /* ──────────────────────────────── catálogo ───────────────────────────── */

  static async listPlans(conn, { onlyActive = true } = {}) {
    const r = await conn.query(
      `SELECT p.id_plan, p.slug, p.name, p.tagline, p.description, p.price_cents,
              p.is_active, p.sort_order,
              COALESCE(
                ARRAY(SELECT f.feature_key
                        FROM public.tb_plan_feature f
                       WHERE f.id_plan = p.id_plan
                       ORDER BY f.feature_key),
                '{}'
              ) AS features
         FROM public.tb_plan p
        ${onlyActive ? "WHERE p.is_active = TRUE" : ""}
        ORDER BY p.sort_order ASC, p.name ASC`
    );
    return r.rows;
  }

  static async getPlanBySlug(conn, slug) {
    const r = await conn.query(
      `SELECT id_plan, slug, name, tagline, description, price_cents, is_active
         FROM public.tb_plan
        WHERE slug = $1
        LIMIT 1`,
      [slug]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getPlanById(conn, id_plan) {
    const r = await conn.query(
      `SELECT id_plan, slug, name, tagline, description, price_cents, is_active
         FROM public.tb_plan
        WHERE id_plan = $1
        LIMIT 1`,
      [id_plan]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Toda chave que pertence a algum plano ATIVO.
   *
   * Plano desativado no admin não deve continuar prendendo função nenhuma: a
   * chave volta ao estado anterior (à venda, ou grátis) em vez de ficar
   * inalcançável para todo mundo — inclusive para quem assinava.
   */
  static async featureKeysInAnyPlan(conn) {
    const r = await conn.query(
      `SELECT DISTINCT f.feature_key
         FROM public.tb_plan_feature f
         JOIN public.tb_plan p ON p.id_plan = f.id_plan
        WHERE p.is_active = TRUE`
    );
    return r.rows.map((row) => row.feature_key);
  }

  /* ─────────────────────────────── assinatura ──────────────────────────── */

  /** A assinatura viva da pessoa, com o plano e as chaves dele. */
  static async getActiveSubscription(conn, id_user) {
    const r = await conn.query(
      `SELECT s.id_subscription, s.id_user, s.id_plan, s.status, s.price_cents,
              s.stripe_subscription_id, s.stripe_customer_id, s.current_period_end,
              s.started_at, s.canceled_at,
              p.slug, p.name, p.tagline,
              COALESCE(
                ARRAY(SELECT f.feature_key
                        FROM public.tb_plan_feature f
                       WHERE f.id_plan = p.id_plan
                       ORDER BY f.feature_key),
                '{}'
              ) AS features
         FROM public.tb_user_plan_subscription s
         JOIN public.tb_plan p ON p.id_plan = s.id_plan
        WHERE s.id_user = $1 AND s.status IN ${LIVE}
        LIMIT 1`,
      [id_user]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /** As chaves que a assinatura viva desta pessoa libera. Vazio = não assina. */
  static async subscribedFeatureKeys(conn, id_user) {
    const r = await conn.query(
      `SELECT DISTINCT f.feature_key
         FROM public.tb_user_plan_subscription s
         JOIN public.tb_plan p ON p.id_plan = s.id_plan AND p.is_active = TRUE
         JOIN public.tb_plan_feature f ON f.id_plan = p.id_plan
        WHERE s.id_user = $1 AND s.status IN ${LIVE}`,
      [id_user]
    );
    return r.rows.map((row) => row.feature_key);
  }

  /**
   * Linha `pending` do checkout. Não dá acesso a nada — quem libera é o
   * webhook, quando o dinheiro entra.
   *
   * ⚠️ Sem ON CONFLICT no id_user: a unicidade viva cobre só `active`/`past_due`
   * de propósito, senão um checkout abandonado impediria a pessoa de tentar de
   * novo para sempre.
   */
  static async createPending(conn, { id_user, id_plan, price_cents, stripe_session_id }) {
    const r = await conn.query(
      `INSERT INTO public.tb_user_plan_subscription
              (id_user, id_plan, status, price_cents, stripe_session_id)
            VALUES ($1, $2, 'pending', $3, $4)
         RETURNING id_subscription, id_user, id_plan, status, price_cents`,
      [id_user, id_plan, price_cents, stripe_session_id || null]
    );
    return r.rows[0];
  }

  static async getBySessionId(conn, stripe_session_id) {
    const r = await conn.query(
      `SELECT id_subscription, id_user, id_plan, status, price_cents
         FROM public.tb_user_plan_subscription
        WHERE stripe_session_id = $1
        LIMIT 1`,
      [stripe_session_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getByStripeSubscription(conn, stripe_subscription_id) {
    const r = await conn.query(
      `SELECT id_subscription, id_user, id_plan, status, price_cents
         FROM public.tb_user_plan_subscription
        WHERE stripe_subscription_id = $1
        LIMIT 1`,
      [stripe_subscription_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Ativa (ou renova) a assinatura. Idempotente: o webhook pode entregar a
   * mesma fatura duas vezes, e reativar o que já está ativo é no-op.
   *
   * `started_at` usa COALESCE para guardar a PRIMEIRA ativação — a data do
   * último pagamento já é `current_period_end` andando para a frente.
   */
  static async activate(conn, id_subscription, { stripe_subscription_id, stripe_customer_id, current_period_end }) {
    const r = await conn.query(
      `UPDATE public.tb_user_plan_subscription
          SET status = 'active',
              stripe_subscription_id = COALESCE($2, stripe_subscription_id),
              stripe_customer_id = COALESCE($3, stripe_customer_id),
              current_period_end = COALESCE($4::timestamptz, current_period_end),
              started_at = COALESCE(started_at, NOW()),
              canceled_at = NULL,
              updated_at = NOW()
        WHERE id_subscription = $1
        RETURNING id_subscription, id_user, id_plan, status`,
      [id_subscription, stripe_subscription_id || null, stripe_customer_id || null, current_period_end || null]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * ⚠️ O booleano do cancelamento é calculado no JS, e não com `$2 = 'canceled'`
   * dentro do CASE.
   *
   * O mesmo parâmetro valendo como COLUNA (varchar) e como COMPARAÇÃO COM
   * LITERAL (text) na mesma query faz o Postgres deduzir dois tipos para ele e
   * recusar com **42P08 — inconsistent types deduced for parameter**. É a
   * armadilha que as migs 202–204 e a 224 já pagaram; aqui ela foi pega pela
   * suíte, não pela produção.
   */
  static async setStatus(conn, id_subscription, status) {
    const isCancel = status === "canceled";
    const r = await conn.query(
      `UPDATE public.tb_user_plan_subscription
          SET status = $2,
              canceled_at = CASE WHEN $3 THEN COALESCE(canceled_at, NOW()) ELSE canceled_at END,
              updated_at = NOW()
        WHERE id_subscription = $1
        RETURNING id_subscription, id_user, id_plan, status`,
      [id_subscription, status, isCancel]
    );
    return r.rowCount ? r.rows[0] : null;
  }
}

module.exports = PlanStorage;
