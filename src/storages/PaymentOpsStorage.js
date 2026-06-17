// Storage de operações/observabilidade de pagamentos (projeto PayDebug).
// Centraliza as consultas de "pedidos pendentes presos" e a coleta de
// session_ids pendentes para a reconciliação contra a API do Stripe.
//
// Cada fluxo de pagamento mantém sua própria tabela de pedido/compra pendente.
// SOURCES descreve onde mora o estado pendente de cada um — é a fonte única
// usada tanto pelo radar de presos quanto pela reconciliação.

const SOURCES = [
  { flow: "loja_produto",   table: "public.tb_profile_product_order", session_col: "stripe_session_id",          pending: "status = 'pending'" },
  { flow: "polens",         table: "public.polen_purchases",          session_col: "stripe_session_id",          pending: "status = 'pending'" },
  { flow: "xp_boost",       table: "public.xp_boost_purchases",       session_col: "stripe_session_id",          pending: "status = 'pending'" },
  { flow: "premium",        table: "public.profile_premium",          session_col: "stripe_session_id",          pending: "status = 'pending'" },
  { flow: "ativacao",       table: "public.tb_profile_subscription",  session_col: "stripe_checkout_session_id", pending: "status = 'pending'" },
  { flow: "casa",           table: "public.casa_participant_product_order", session_col: "stripe_session_id",     pending: "status = 'pending'" },
  { flow: "agendamento",    table: "public.tb_profile_bookings",      session_col: "stripe_checkout_session_id", pending: "status = 'pending_payment'" },
];

class PaymentOpsStorage {
  static get SOURCES() {
    return SOURCES;
  }

  /**
   * Conta, por fluxo, os pedidos que estão pendentes há mais de N horas — o
   * sintoma de "pagou mas não recebeu" (webhook perdido) ou de checkout
   * abandonado que nunca foi limpo. Robusto: se a tabela de um fluxo não
   * existir no ambiente, devolve count 0 para aquele fluxo em vez de quebrar.
   */
  static async staleCounts(conn, { olderThanHours = 24 } = {}) {
    const out = [];
    for (const s of SOURCES) {
      try {
        const { rows } = await conn.query(
          `SELECT COUNT(*)::int AS count
             FROM ${s.table}
            WHERE ${s.pending}
              AND ${s.session_col} IS NOT NULL
              AND created_at < NOW() - INTERVAL '1 hour' * $1`,
          [olderThanHours]
        );
        out.push({ flow: s.flow, count: rows[0]?.count || 0 });
      } catch (err) {
        out.push({ flow: s.flow, count: 0, error: err.code || err.message });
      }
    }
    return out;
  }

  /**
   * Coleta session_ids pendentes em janela [olderThanMinutes, youngerThanDays]
   * para a reconciliação. Mais novos que `olderThanMinutes` ainda podem estar
   * em processamento normal; mais velhos que `youngerThanDays` são considerados
   * abandonados (o ciclo de vida expira via checkout.session.expired).
   */
  static async listStaleSessions(conn, { olderThanMinutes = 30, youngerThanDays = 3, limit = 100 } = {}) {
    const out = [];
    for (const s of SOURCES) {
      try {
        const { rows } = await conn.query(
          `SELECT ${s.session_col} AS session_id
             FROM ${s.table}
            WHERE ${s.pending}
              AND ${s.session_col} IS NOT NULL
              AND created_at < NOW() - INTERVAL '1 minute' * $1
              AND created_at > NOW() - INTERVAL '1 day' * $2
            ORDER BY created_at ASC
            LIMIT $3`,
          [olderThanMinutes, youngerThanDays, limit]
        );
        for (const r of rows) {
          if (r.session_id) out.push({ flow: s.flow, session_id: r.session_id });
        }
      } catch {
        /* tabela ausente no ambiente — ignora esse fluxo */
      }
    }
    return out;
  }
}

module.exports = PaymentOpsStorage;
