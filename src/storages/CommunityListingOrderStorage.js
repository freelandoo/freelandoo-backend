// src/storages/CommunityListingOrderStorage.js
// SQL da VENDA dentro da vitrine do vizinho (mig 249): pedido, repasse com
// holdback e disputa.
//
// ⚠️ AS MESMAS DUAS REGRAS DO DELIVERY valem aqui:
//
// 1. TODA TRANSIÇÃO É CONDICIONADA AO ESTADO ANTERIOR. O UPDATE que não casa
//    devolve zero linhas, e o service transforma isso numa recusa que se
//    explica — em vez de dois caminhos concluindo a mesma venda.
// 2. TIMESTAMP VEM PRONTO DO JS, nunca de um `CASE` sobre um parâmetro que
//    também é coluna (42P08).

class CommunityListingOrderStorage {
  /* -------------------------------- pedido -------------------------------- */

  static async create(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_listing_order
         (id_listing, id_community, id_buyer, id_seller,
          listing_title, listing_kind, price_cents,
          delivery_cents, delivery_kind,
          amount_cents, platform_fee_cents, processor_fee_cents,
          processor_fee_source, seller_cents, courier_cents, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        data.id_listing ?? null,
        data.id_community,
        data.id_buyer,
        data.id_seller,
        data.listing_title,
        data.listing_kind,
        data.price_cents,
        data.delivery_cents || 0,
        data.delivery_kind ?? null,
        data.amount_cents,
        data.platform_fee_cents || 0,
        data.processor_fee_cents || 0,
        data.processor_fee_source || "fallback",
        data.seller_cents || 0,
        data.courier_cents || 0,
        data.note ?? null,
      ]
    );
    return r.rows[0];
  }

  static async getById(conn, id_order) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_listing_order WHERE id_order = $1 LIMIT 1`,
      [id_order]
    );
    return r.rows[0] || null;
  }

  static async getBySession(conn, session_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_listing_order WHERE session_id = $1 LIMIT 1`,
      [session_id]
    );
    return r.rows[0] || null;
  }

  static async getByProviderRef(conn, provider_ref) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_listing_order WHERE provider_ref = $1 LIMIT 1`,
      [provider_ref]
    );
    return r.rows[0] || null;
  }

  static async attachCharge(conn, id_order, { provider, session_id, provider_ref, checkout_url }) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_order
          SET payment_provider = $2,
              session_id = $3,
              provider_ref = $4,
              checkout_url = $5,
              updated_at = NOW()
        WHERE id_order = $1
        RETURNING *`,
      [id_order, provider, session_id, provider_ref, checkout_url ?? null]
    );
    return r.rows[0] || null;
  }

  /**
   * Webhook: o pagamento caiu.
   *
   * ⚠️ IDEMPOTENTE POR SESSION ID (`WHERE status = 'pending'`): o webhook é
   * at-least-once, e a reentrega devolve zero linhas. Quem chama transforma
   * isso em `{ already: true }` — nunca num segundo repasse.
   */
  static async markPaid(conn, session_id, provider_ref = null) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_order
          SET status = 'paid',
              paid_at = NOW(),
              provider_ref = COALESCE($2, provider_ref),
              updated_at = NOW()
        WHERE session_id = $1 AND status = 'pending'
        RETURNING *`,
      [session_id, provider_ref]
    );
    return r.rows[0] || null;
  }

  /**
   * A tarifa REAL substitui a estimativa e os DOIS líquidos são recalculados
   * no banco, com o mesmo rateio proporcional do `utils/listingOrder.js`.
   *
   * ⚠️ OS TRÊS VALORES CHEGAM PRONTOS do JS em vez de a conta ser refeita em
   * SQL. Uma segunda cópia da fórmula aqui divergiria da primeira na regra
   * seguinte — e divergência em conta de dinheiro só aparece quando alguém soma
   * as partes e vê que não fecham.
   */
  static async applyProcessorFee(conn, id_order, { fee_cents, seller_cents, courier_cents }) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_order
          SET processor_fee_cents = $2,
              processor_fee_source = 'gateway',
              seller_cents = GREATEST(0, $3),
              courier_cents = GREATEST(0, $4),
              updated_at = NOW()
        WHERE id_order = $1
        RETURNING *`,
      [id_order, fee_cents, seller_cents, courier_cents]
    );
    return r.rows[0] || null;
  }

  static async attachDelivery(conn, id_order, id_delivery) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_order
          SET id_delivery = $2, updated_at = NOW()
        WHERE id_order = $1 AND id_delivery IS NULL
        RETURNING *`,
      [id_order, id_delivery]
    );
    return r.rows[0] || null;
  }

  /** O vendedor diz "entreguei" — e só de `paid`. */
  static async markDelivered(conn, id_order, id_seller, { delivered_at, confirm_due_at }) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_order
          SET status = 'delivered',
              delivered_at = $3,
              confirm_due_at = $4,
              updated_at = NOW()
        WHERE id_order = $1 AND id_seller = $2 AND status = 'paid'
        RETURNING *`,
      [id_order, id_seller, delivered_at, confirm_due_at]
    );
    return r.rows[0] || null;
  }

  /**
   * Conclui. Serve os DOIS caminhos (o comprador confirmando e o prazo
   * vencendo), porque o efeito é o mesmo.
   *
   * ⚠️ `status = 'delivered'` no WHERE é o que impede uma venda EM DISPUTA de
   * ser concluída por trás: disputa move o pedido para `disputed`, e daí ele
   * não volta sozinho.
   */
  static async markCompleted(conn, id_order, { completed_at }) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_order
          SET status = 'completed', completed_at = $2, updated_at = NOW()
        WHERE id_order = $1 AND status = 'delivered'
        RETURNING *`,
      [id_order, completed_at]
    );
    return r.rows[0] || null;
  }

  static async markCanceled(conn, session_id) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_order
          SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
        WHERE session_id = $1 AND status = 'pending'
        RETURNING *`,
      [session_id]
    );
    return r.rows[0] || null;
  }

  static async markRefunded(conn, id_order) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_order
          SET status = 'refunded', refunded_at = NOW(), updated_at = NOW()
        WHERE id_order = $1 AND refunded_at IS NULL
        RETURNING *`,
      [id_order]
    );
    return r.rows[0] || null;
  }

  /**
   * ⚠️ `completed` ESTÁ NA LISTA. A confirmação vence em 7 dias (o pedido
   * conclui sozinho) e o holdback só termina em 8: existe um dia em que o
   * dinheiro ainda está retido e o comprador precisa poder contestar. Quem
   * manda na janela é o REPASSE, não o status do pedido.
   *
   * ⚠️ E É POR ISSO QUE O `NOT EXISTS` DA DISPUTA NO `releaseDuePayouts` NÃO É
   * REDUNDANTE: sem esta linha, um pedido `completed` nunca teria disputa
   * aberta e aquela cláusula seria código morto. Com ela, ela é o que segura o
   * dinheiro de uma briga aberta quando o holdback vence.
   */
  static async markDisputed(conn, id_order) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_order
          SET status = 'disputed', updated_at = NOW()
        WHERE id_order = $1 AND status IN ('paid', 'delivered', 'completed')
        RETURNING *`,
      [id_order]
    );
    return r.rows[0] || null;
  }

  /** Volta de `disputed` para o estado em que dá para concluir. */
  static async undispute(conn, id_order) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_order
          SET status = 'delivered', updated_at = NOW()
        WHERE id_order = $1 AND status = 'disputed'
        RETURNING *`,
      [id_order]
    );
    return r.rows[0] || null;
  }

  static async listForUser(conn, id_user, { role = "buyer", id_community = null, limit = 50 } = {}) {
    const col = role === "seller" ? "id_seller" : "id_buyer";
    const params = [id_user];
    let filter = "";
    if (id_community) {
      params.push(id_community);
      filter = ` AND o.id_community = $${params.length}`;
    }
    params.push(Math.min(Number(limit) || 50, 100));
    const r = await conn.query(
      `SELECT o.*,
              bu.username AS buyer_username, bu.nome AS buyer_name,
              su.username AS seller_username, su.nome AS seller_name,
              c.display_name AS community_name,
              (SELECT d.status FROM public.tb_community_listing_dispute d
                WHERE d.id_order = o.id_order AND d.status = 'open' LIMIT 1) AS dispute_status
         FROM public.tb_community_listing_order o
         JOIN public.tb_user bu ON bu.id_user = o.id_buyer
         JOIN public.tb_user su ON su.id_user = o.id_seller
         JOIN public.tb_profile c ON c.id_profile = o.id_community
        WHERE o.${col} = $1 ${filter}
        ORDER BY o.created_at DESC
        LIMIT $${params.length}`,
      params
    );
    return r.rows;
  }

  /**
   * O sweeper de confirmação: entregue e não confirmado no prazo conclui
   * sozinho.
   *
   * ⚠️ `status = 'delivered'` deixa a venda EM DISPUTA de fora — liberar o
   * dinheiro de uma briga aberta porque o prazo bateu seria decidir a favor do
   * vendedor por decurso, que é exatamente o que a disputa existe para evitar.
   */
  static async releaseDueConfirmations(conn, { limit = 200 } = {}) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_order
          SET status = 'completed', completed_at = NOW(), updated_at = NOW()
        WHERE id_order IN (
          SELECT id_order FROM public.tb_community_listing_order
           WHERE status = 'delivered'
             AND confirm_due_at IS NOT NULL
             AND confirm_due_at <= NOW()
           ORDER BY confirm_due_at ASC
           LIMIT $1
        )
        RETURNING *`,
      [limit]
    );
    return r.rows;
  }

  /* -------------------------------- repasse ------------------------------- */

  static async createPayout(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_listing_payout
         (id_order, id_community, id_seller, listing_title, charge_cents,
          platform_fee_cents, processor_fee_cents, net_cents, status, available_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'aguardando',$9)
       ON CONFLICT (id_order) DO NOTHING
       RETURNING *`,
      [
        data.id_order,
        data.id_community,
        data.id_seller,
        data.listing_title,
        data.charge_cents,
        data.platform_fee_cents,
        data.processor_fee_cents,
        data.net_cents,
        data.available_at,
      ]
    );
    return r.rows[0] || null;
  }

  static async getPayoutByOrder(conn, id_order) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_listing_payout WHERE id_order = $1 LIMIT 1`,
      [id_order]
    );
    return r.rows[0] || null;
  }

  /**
   * O HOLDBACK vencendo: o que esperou os 8 dias vira saldo aprovado.
   *
   * ⚠️ A CLÁUSULA `EXISTS` DA DISPUTA É O QUE TORNA A DISPUTA REAL. Sem ela, o
   * sweeper liberaria o dinheiro de uma briga aberta assim que o prazo batesse,
   * e a disputa seria um formulário que não segura nada.
   */
  static async releaseDuePayouts(conn, { limit = 200 } = {}) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_payout p
          SET status = 'aprovado', approved_at = NOW(), updated_at = NOW()
        WHERE p.id_payout IN (
          SELECT p2.id_payout
            FROM public.tb_community_listing_payout p2
            JOIN public.tb_community_listing_order o ON o.id_order = p2.id_order
           WHERE p2.status = 'aguardando'
             AND p2.available_at <= NOW()
             AND o.status = 'completed'
             AND NOT EXISTS (
               SELECT 1 FROM public.tb_community_listing_dispute d
                WHERE d.id_order = p2.id_order AND d.status = 'open'
             )
           ORDER BY p2.available_at ASC
           LIMIT $1
        )
        RETURNING p.id_payout, p.id_seller, p.net_cents`,
      [limit]
    );
    return r.rows;
  }

  static async revertPayout(conn, id_order) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_payout
          SET status = 'revertido', reverted_at = NOW(), updated_at = NOW()
        WHERE id_order = $1 AND status IN ('aguardando', 'aprovado')
        RETURNING *`,
      [id_order]
    );
    return r.rows[0] || null;
  }

  static async approvePayout(conn, id_order) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_payout
          SET status = 'aprovado', approved_at = NOW(), available_at = NOW(), updated_at = NOW()
        WHERE id_order = $1 AND status = 'aguardando'
        RETURNING *`,
      [id_order]
    );
    return r.rows[0] || null;
  }

  static async listPayoutsForSeller(conn, id_seller, { limit = 100 } = {}) {
    const r = await conn.query(
      `SELECT p.*, c.display_name AS community_name
         FROM public.tb_community_listing_payout p
         JOIN public.tb_profile c ON c.id_profile = p.id_community
        WHERE p.id_seller = $1
        ORDER BY p.created_at DESC
        LIMIT $2`,
      [id_seller, limit]
    );
    return r.rows;
  }

  static async summaryForSeller(conn, id_seller) {
    const r = await conn.query(
      `SELECT
          COALESCE(SUM(CASE WHEN status='aguardando' THEN net_cents END), 0)::int AS aguardando_cents,
          COALESCE(SUM(CASE WHEN status='aprovado'   THEN net_cents END), 0)::int AS aprovado_cents,
          COALESCE(SUM(CASE WHEN status='pago'       THEN net_cents END), 0)::int AS pago_cents,
          COALESCE(SUM(CASE WHEN status='revertido'  THEN net_cents END), 0)::int AS revertido_cents,
          COUNT(*) FILTER (WHERE status IN ('aprovado','pago'))::int AS vendas
         FROM public.tb_community_listing_payout
        WHERE id_seller = $1`,
      [id_seller]
    );
    return r.rows[0];
  }

  /* -------------------------------- disputa ------------------------------- */

  /**
   * ⚠️ `ON CONFLICT DO NOTHING` sobre o índice parcial de disputa VIVA: apertar
   * duas vezes é o caso comum de quem está bravo, e sem isto o segundo clique
   * viraria 500 de unicidade na cara de quem acabou de perder dinheiro.
   */
  static async openDispute(conn, { id_order, id_opener, reason, detail }) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_listing_dispute
         (id_order, id_opener, reason, detail)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id_order) WHERE status = 'open' DO NOTHING
       RETURNING *`,
      [id_order, id_opener, reason, detail ?? null]
    );
    if (r.rows[0]) return r.rows[0];
    const existing = await conn.query(
      `SELECT * FROM public.tb_community_listing_dispute
        WHERE id_order = $1 AND status = 'open' LIMIT 1`,
      [id_order]
    );
    return existing.rows[0] || null;
  }

  static async getOpenDispute(conn, id_order) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_listing_dispute
        WHERE id_order = $1 AND status = 'open' LIMIT 1`,
      [id_order]
    );
    return r.rows[0] || null;
  }

  static async decideDispute(conn, id_dispute, { status, decided_by, decision_note }) {
    const r = await conn.query(
      `UPDATE public.tb_community_listing_dispute
          SET status = $2, decided_by = $3, decision_note = $4, decided_at = NOW()
        WHERE id_dispute = $1 AND status = 'open'
        RETURNING *`,
      [id_dispute, status, decided_by ?? null, decision_note ?? null]
    );
    return r.rows[0] || null;
  }

  static async listOpenDisputes(conn, { limit = 100 } = {}) {
    const r = await conn.query(
      `SELECT d.*, o.listing_title, o.amount_cents, o.id_community, o.id_buyer, o.id_seller,
              bu.username AS buyer_username, su.username AS seller_username,
              c.display_name AS community_name
         FROM public.tb_community_listing_dispute d
         JOIN public.tb_community_listing_order o ON o.id_order = d.id_order
         JOIN public.tb_user bu ON bu.id_user = o.id_buyer
         JOIN public.tb_user su ON su.id_user = o.id_seller
         JOIN public.tb_profile c ON c.id_profile = o.id_community
        WHERE d.status = 'open'
        ORDER BY d.created_at ASC
        LIMIT $1`,
      [limit]
    );
    return r.rows;
  }
}

module.exports = CommunityListingOrderStorage;
