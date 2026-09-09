// src/storages/PaymentIntentStorage.js
// SQL puro da intenção de pagamento (mig 231).
//
// ─── A ORDEM DAS DUAS ESCRITAS É O DESENHO ──────────────────────────────────
//
// `create` roda ANTES da chamada de rede ao gateway; `attachProviderRef` roda
// DEPOIS, com o id que voltou. Nunca o contrário.
//
// Invertido, uma falha de rede no meio da criação da cobrança deixaria a
// cobrança de pé no gateway (o Asaas já a criou) sem nenhuma linha aqui — e o
// webhook chegaria com um `externalReference` que não existe no nosso banco.
// Pagamento órfão, cobrado, sem dono e sem entrega.
//
// Nesta ordem o pior caso é o inverso e é inofensivo: uma intenção `created`
// que nunca virou cobrança. Ela aparece no radar de presas e some sozinha do
// caminho de quem paga.

const { assertPaymentFlow } = require("../utils/paymentFlows");

class PaymentIntentStorage {
  /**
   * Abre a intenção. Devolve a linha inteira — quem chama precisa do
   * `id_payment_intent` para mandar ao gateway como referência externa.
   *
   * ⚠️ `assertPaymentFlow` aqui não é contra injeção (o fluxo entra como
   * parâmetro $2, nunca interpolado): é contra o erro de digitação que
   * produziria uma cobrança paga que nenhum confirmador reconhece.
   */
  static async create(conn, { provider, flow, id_user = null, payload = {}, amount_cents, currency = "BRL" }) {
    assertPaymentFlow(flow);
    const { rows } = await conn.query(
      `INSERT INTO public.tb_payment_intent
         (provider, flow, id_user, payload, amount_cents, currency)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING *`,
      [provider, flow, id_user, JSON.stringify(payload || {}), Math.round(Number(amount_cents) || 0), currency]
    );
    return rows[0];
  }

  /**
   * Carimba o id da cobrança no gateway.
   *
   * ⚠️ Só carimba enquanto `provider_ref IS NULL`. Sem essa guarda, um retry
   * que recriasse a cobrança sobrescreveria a referência da primeira — e a
   * primeira, se fosse paga, chegaria no webhook apontando para uma linha que
   * agora jura pertencer a outra cobrança.
   */
  static async attachProviderRef(conn, id_payment_intent, { provider_ref, provider_customer_id = null }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_payment_intent
          SET provider_ref = $2,
              provider_customer_id = COALESCE($3, provider_customer_id),
              updated_at = NOW()
        WHERE id_payment_intent = $1
          AND provider_ref IS NULL
        RETURNING *`,
      [id_payment_intent, provider_ref, provider_customer_id]
    );
    return rows[0] || null;
  }

  static async getById(conn, id_payment_intent) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_payment_intent WHERE id_payment_intent = $1 LIMIT 1`,
      [id_payment_intent]
    );
    return rows[0] || null;
  }

  /**
   * O caminho do webhook: da referência do gateway de volta ao significado.
   * O `provider` entra no WHERE porque os espaços de id dos dois provedores são
   * independentes e nada garante que não colidam.
   */
  static async getByProviderRef(conn, provider, provider_ref) {
    if (!provider_ref) return null;
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_payment_intent
        WHERE provider = $1 AND provider_ref = $2 LIMIT 1`,
      [provider, provider_ref]
    );
    return rows[0] || null;
  }

  /**
   * Transição de status.
   *
   * ⚠️ Estado FINAL não regride. O Asaas entrega at-least-once e fora de ordem;
   * sem essa trava um `PAYMENT_CREATED` reentregue depois do `PAYMENT_RECEIVED`
   * devolveria uma cobrança paga para `created`, e o radar de presas passaria a
   * apontar dinheiro que já foi entregue.
   *
   * `refunded` é a única exceção: reembolso é posterior ao pagamento por
   * definição, então ele vence `paid`.
   */
  static async setStatus(conn, id_payment_intent, status) {
    const { rows } = await conn.query(
      `UPDATE public.tb_payment_intent
          SET status = $2, updated_at = NOW()
        WHERE id_payment_intent = $1
          AND (
                status = 'created'
             OR ($2 = 'refunded' AND status = 'paid')
          )
        RETURNING *`,
      [id_payment_intent, status]
    );
    return rows[0] || null;
  }

  /**
   * Radar: intenções que foram mandadas ao gateway e nunca voltaram. Sem o
   * `provider_ref IS NOT NULL` a conta incluiria as que morreram antes de virar
   * cobrança — ruído, não sintoma.
   */
  static async staleCounts(conn, { olderThanHours = 24 } = {}) {
    const { rows } = await conn.query(
      `SELECT provider, flow, COUNT(*)::int AS count
         FROM public.tb_payment_intent
        WHERE status = 'created'
          AND provider_ref IS NOT NULL
          AND created_at < NOW() - INTERVAL '1 hour' * $1
        GROUP BY provider, flow
        ORDER BY count DESC`,
      [olderThanHours]
    );
    return rows;
  }
}

module.exports = PaymentIntentStorage;
