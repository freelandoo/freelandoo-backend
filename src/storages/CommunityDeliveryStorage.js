// src/storages/CommunityDeliveryStorage.js
// SQL do DELIVERY entre vizinhos (mig 248).
//
// ⚠️ DUAS REGRAS ATRAVESSAM ESTE ARQUIVO INTEIRO:
//
// 1. TODA TRANSIÇÃO DE ESTADO É CONDICIONADA AO ESTADO ANTERIOR
//    (`WHERE status = 'open'`, `WHERE status = 'accepted'`…). Não é otimização:
//    é o que serializa a corrida de dois vizinhos apertando "Aceitar" no mesmo
//    segundo. O UPDATE que não casa devolve zero linhas, e o service transforma
//    isso em "alguém já pegou" — em vez de dois cobrados pela mesma entrega.
//
// 2. TIMESTAMP E BOOLEANO VÊM PRONTOS DO JS, nunca de um `CASE` sobre um
//    parâmetro que também é coluna. O mesmo parâmetro usado como varchar e
//    dentro de uma expressão faz o Postgres deduzir tipos inconsistentes
//    (42P08) — custou as migs 202-204, a 224 e o sweeper do WhatsApp.

class CommunityDeliveryStorage {
  /* ------------------------------- chamados ------------------------------ */

  static async create(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_delivery_request
         (id_community, id_requester, kind, price_cents, note, pickup, dropoff,
          expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        data.id_community,
        data.id_requester,
        data.kind,
        data.price_cents,
        data.note ?? null,
        data.pickup ?? null,
        data.dropoff ?? null,
        data.expires_at,
      ]
    );
    return r.rows[0];
  }

  static async getById(conn, id_delivery) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_delivery_request WHERE id_delivery = $1 LIMIT 1`,
      [id_delivery]
    );
    return r.rows[0] || null;
  }

  /**
   * O quadro da comunidade. `mine` recorta o que é meu (pedido OU aceito por
   * mim) — é a aba "minhas corridas", e ela precisa mostrar as duas pontas:
   * quem pede e quem entrega são a mesma pessoa em momentos diferentes.
   */
  static async list(conn, id_community, { status = "open", mine = null, limit = 50, offset = 0 } = {}) {
    const params = [id_community];
    let filter = "";
    if (status && status !== "all") {
      params.push(status);
      filter += ` AND d.status = $${params.length}`;
    }
    if (mine) {
      params.push(mine);
      filter += ` AND (d.id_requester = $${params.length} OR d.id_courier = $${params.length})`;
    }
    params.push(Math.min(Number(limit) || 50, 100));
    params.push(Number(offset) || 0);

    // O avatar sai do perfil de maior XP da pessoa (mesmo LATERAL da vitrine):
    // o rosto de quem pede e de quem entrega é o que faz a corrida parecer com
    // um vizinho, e não com um pedido de aplicativo.
    const r = await conn.query(
      `SELECT d.*,
              ru.username AS requester_username,
              ru.nome     AS requester_name,
              rp.avatar_url AS requester_avatar,
              cu.username AS courier_username,
              cu.nome     AS courier_name,
              cp.avatar_url AS courier_avatar
         FROM public.tb_community_delivery_request d
         JOIN public.tb_user ru ON ru.id_user = d.id_requester
         LEFT JOIN LATERAL (
           SELECT avatar_url FROM public.tb_profile
            WHERE id_user = d.id_requester
              AND is_clan = FALSE AND is_community = FALSE AND deleted_at IS NULL
            ORDER BY xp_total DESC LIMIT 1
         ) rp ON TRUE
         LEFT JOIN public.tb_user cu ON cu.id_user = d.id_courier
         LEFT JOIN LATERAL (
           SELECT avatar_url FROM public.tb_profile
            WHERE id_user = d.id_courier
              AND is_clan = FALSE AND is_community = FALSE AND deleted_at IS NULL
            ORDER BY xp_total DESC LIMIT 1
         ) cp ON TRUE
        WHERE d.id_community = $1 ${filter}
        ORDER BY d.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  /**
   * O ACEITE, atômico.
   *
   * ⚠️ `WHERE status = 'open' AND id_courier IS NULL` é o coração da feature:
   * é ele que faz dois vizinhos apertando "Aceitar" no mesmo instante
   * resultarem em UM aceite e um "alguém já pegou". Sem a condição, os dois
   * seriam cobrados pela mesma corrida.
   *
   * ⚠️ E `expires_at > NOW()` está aqui porque o sweeper roda de tempos em
   * tempos: entre a expiração de fato e a varredura existe uma janela em que a
   * linha ainda diz `open`. Aceitar nela cobraria por um chamado morto.
   */
  static async accept(conn, id_delivery, id_courier, { accepted_at }) {
    const r = await conn.query(
      `UPDATE public.tb_community_delivery_request
          SET status = 'accepted',
              id_courier = $2,
              accepted_at = $3,
              updated_at = NOW()
        WHERE id_delivery = $1
          AND status = 'open'
          AND id_courier IS NULL
          AND expires_at > NOW()
        RETURNING *`,
      [id_delivery, id_courier, accepted_at]
    );
    return r.rows[0] || null;
  }

  /**
   * Carimba a cobrança criada no aceite.
   *
   * ⚠️ A `checkout_url` É GUARDADA porque quem paga não está na tela: a
   * cobrança nasce quando o ENTREGADOR aceita, e quem paga é quem PEDIU. Sem
   * guardar, o link existiria só na resposta do clique de outra pessoa.
   */
  static async attachCharge(conn, id_delivery, { provider, session_id, provider_ref, checkout_url, processor_fee_cents, processor_fee_source, courier_cents }) {
    const r = await conn.query(
      `UPDATE public.tb_community_delivery_request
          SET payment_provider = $2,
              session_id = $3,
              provider_ref = $4,
              checkout_url = $5,
              payment_status = 'pending',
              processor_fee_cents = $6,
              processor_fee_source = $7,
              courier_cents = $8,
              updated_at = NOW()
        WHERE id_delivery = $1
        RETURNING *`,
      [
        id_delivery,
        provider,
        session_id,
        provider_ref,
        checkout_url ?? null,
        processor_fee_cents,
        processor_fee_source,
        courier_cents,
      ]
    );
    return r.rows[0] || null;
  }

  static async getBySession(conn, session_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_delivery_request WHERE session_id = $1 LIMIT 1`,
      [session_id]
    );
    return r.rows[0] || null;
  }

  static async getByProviderRef(conn, provider_ref) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_delivery_request WHERE provider_ref = $1 LIMIT 1`,
      [provider_ref]
    );
    return r.rows[0] || null;
  }

  /**
   * Webhook: o pagamento do aceite caiu.
   *
   * ⚠️ IDEMPOTENTE POR SESSION ID (`WHERE payment_status = 'pending'`): o
   * webhook é at-least-once, e a reentrega devolve zero linhas em vez de
   * marcar duas vezes. Quem chama transforma isso em `{ already: true }`.
   */
  static async markPaid(conn, session_id, provider_ref = null) {
    const r = await conn.query(
      `UPDATE public.tb_community_delivery_request
          SET payment_status = 'paid',
              provider_ref = COALESCE($2, provider_ref),
              updated_at = NOW()
        WHERE session_id = $1 AND payment_status = 'pending'
        RETURNING *`,
      [session_id, provider_ref]
    );
    return r.rows[0] || null;
  }

  /**
   * A TARIFA REAL substitui a estimativa, e o líquido é recalculado no BANCO.
   *
   * ⚠️ `GREATEST(0, ...)` é a mesma trava do `courierNet` do util, aqui porque
   * o número tem que ser não-negativo NA COLUNA (o CHECK da mig 248 recusaria)
   * — e um CHECK estourando no webhook faria o Stripe reentregar o evento para
   * sempre.
   */
  static async applyProcessorFee(conn, id_delivery, fee_cents) {
    const r = await conn.query(
      `UPDATE public.tb_community_delivery_request
          SET processor_fee_cents = $2,
              processor_fee_source = 'gateway',
              courier_cents = GREATEST(0, price_cents - $2),
              updated_at = NOW()
        WHERE id_delivery = $1
        RETURNING *`,
      [id_delivery, fee_cents]
    );
    return r.rows[0] || null;
  }

  /** "Entreguei" — só quem aceitou, e só de `accepted`. */
  static async markDelivered(conn, id_delivery, id_courier, { delivered_at, confirm_due_at }) {
    const r = await conn.query(
      `UPDATE public.tb_community_delivery_request
          SET status = 'delivered',
              delivered_at = $3,
              confirm_due_at = $4,
              updated_at = NOW()
        WHERE id_delivery = $1
          AND id_courier = $2
          AND status = 'accepted'
        RETURNING *`,
      [id_delivery, id_courier, delivered_at, confirm_due_at]
    );
    return r.rows[0] || null;
  }

  /**
   * Conclui a corrida. Serve os DOIS caminhos — quem pediu confirmando e o
   * prazo vencendo — porque o efeito é o mesmo: vira saldo. A diferença fica no
   * log de quem chamou, não no estado.
   */
  static async markCompleted(conn, id_delivery, { completed_at }) {
    const r = await conn.query(
      `UPDATE public.tb_community_delivery_request
          SET status = 'completed',
              completed_at = $2,
              updated_at = NOW()
        WHERE id_delivery = $1 AND status = 'delivered'
        RETURNING *`,
      [id_delivery, completed_at]
    );
    return r.rows[0] || null;
  }

  /**
   * O entregador desistiu: o chamado VOLTA A FICAR ABERTO para outra pessoa.
   *
   * ⚠️ REABRIR É O DESENHO, e não cancelar de vez: quem pediu continua
   * precisando da entrega, e matar o chamado o obrigaria a abrir tudo de novo
   * por uma desistência que não foi dele. A cobrança é estornada INTEIRA pelo
   * service (a plataforma come a tarifa) e os campos de pagamento voltam a
   * zero, senão a próxima pessoa herdaria a sessão de cobrança da anterior.
   *
   * ⚠️ E `expires_at` é ESTENDIDO: reabrir um chamado que expira em dois
   * minutos é reabrir para ninguém.
   */
  static async releaseByCourier(conn, id_delivery, id_courier, { expires_at }) {
    const r = await conn.query(
      `UPDATE public.tb_community_delivery_request
          SET status = 'open',
              id_courier = NULL,
              accepted_at = NULL,
              payment_status = 'refunded',
              session_id = NULL,
              provider_ref = NULL,
              payment_provider = NULL,
              checkout_url = NULL,
              processor_fee_cents = 0,
              processor_fee_source = 'none',
              courier_cents = 0,
              expires_at = $3,
              cancel_reason = 'courier',
              updated_at = NOW()
        WHERE id_delivery = $1
          AND id_courier = $2
          AND status IN ('accepted', 'delivered')
        RETURNING *`,
      [id_delivery, id_courier, expires_at]
    );
    return r.rows[0] || null;
  }

  /**
   * O entregador desiste de um chamado PRÉ-PAGO (o add-on "+R$3" de uma compra
   * na vitrine, mig 249).
   *
   * ⚠️ AQUI O PAGAMENTO FICA. É a diferença inteira para o `releaseByCourier`
   * acima: naquele, a cobrança era da corrida e o estorno é integral; neste, a
   * cobrança é a do PEDIDO INTEIRO — zerar `provider_ref` e `payment_status`
   * aqui faria a entrega parecer não paga, e o próximo vizinho a aceitar seria
   * cobrado por uma entrega que o comprador já pagou.
   *
   * O que muda é só quem está com ela: volta para a fila, ainda paga, com o
   * líquido intacto para quem pegar.
   */
  static async releasePrepaidByCourier(conn, id_delivery, id_courier, { expires_at }) {
    const r = await conn.query(
      `UPDATE public.tb_community_delivery_request
          SET status = 'open',
              id_courier = NULL,
              accepted_at = NULL,
              expires_at = $3,
              cancel_reason = 'courier',
              updated_at = NOW()
        WHERE id_delivery = $1
          AND id_courier = $2
          AND status IN ('accepted', 'delivered')
          AND id_listing_order IS NOT NULL
        RETURNING *`,
      [id_delivery, id_courier, expires_at]
    );
    return r.rows[0] || null;
  }

  /**
   * Quem PEDIU cancela — só enquanto ninguém pegou.
   *
   * ⚠️ Depois do aceite ele não cancela mais: alguém já foi cobrado e já está a
   * caminho. O que existe dali em diante é não confirmar (e aí o prazo decide)
   * ou o entregador desistir.
   */
  static async cancelByRequester(conn, id_delivery, id_requester, { canceled_at }) {
    const r = await conn.query(
      `UPDATE public.tb_community_delivery_request
          SET status = 'canceled',
              canceled_at = $3,
              cancel_reason = 'requester',
              updated_at = NOW()
        WHERE id_delivery = $1 AND id_requester = $2 AND status = 'open'
        RETURNING *`,
      [id_delivery, id_requester, canceled_at]
    );
    return r.rows[0] || null;
  }

  /**
   * O sweeper de expiração.
   *
   * ⚠️ SÓ TOCA EM `open`, e é isso que garante a decisão do Alex: chamado que
   * ninguém pegou morre SEM COBRANÇA NENHUMA. `payment_status` continua `none`
   * porque nunca houve cobrança — e o teste escreve exatamente isso como
   * asserção.
   */
  static async expireDue(conn, { limit = 200 } = {}) {
    const r = await conn.query(
      `UPDATE public.tb_community_delivery_request
          SET status = 'expired',
              canceled_at = NOW(),
              cancel_reason = 'expired',
              updated_at = NOW()
        WHERE id_delivery IN (
          SELECT id_delivery FROM public.tb_community_delivery_request
           WHERE status = 'open' AND expires_at <= NOW()
           ORDER BY expires_at ASC
           LIMIT $1
        )
        RETURNING id_delivery, id_community, id_requester, kind`,
      [limit]
    );
    return r.rows;
  }

  /**
   * O sweeper de liberação: entregue e não confirmado dentro do prazo vira
   * concluído sozinho.
   *
   * ⚠️ É ele que fecha a fraude de quem recebe a encomenda e nunca confirma
   * para não pagar. Sem prazo, o repasse dependeria da boa vontade de quem já
   * ficou com a coisa.
   */
  static async releaseDueConfirmations(conn, { limit = 200 } = {}) {
    const r = await conn.query(
      `UPDATE public.tb_community_delivery_request
          SET status = 'completed',
              completed_at = NOW(),
              updated_at = NOW()
        WHERE id_delivery IN (
          SELECT id_delivery FROM public.tb_community_delivery_request
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

  /* -------------------------------- repasse ------------------------------ */

  /**
   * ⚠️ `ON CONFLICT (id_delivery) DO NOTHING` é a idempotência do repasse: os
   * dois caminhos de conclusão (confirmação e prazo) podem correr quase juntos,
   * e um repasse duplicado é dinheiro criado do nada.
   */
  static async createPayout(conn, data) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_delivery_payout
         (id_delivery, id_community, id_courier, kind, charge_cents,
          processor_fee_cents, net_cents, status, available_at, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'aprovado', NOW(), NOW())
       ON CONFLICT (id_delivery) DO NOTHING
       RETURNING *`,
      [
        data.id_delivery,
        data.id_community,
        data.id_courier,
        data.kind,
        data.charge_cents,
        data.processor_fee_cents,
        data.net_cents,
      ]
    );
    return r.rows[0] || null;
  }

  static async getPayoutByDelivery(conn, id_delivery) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_delivery_payout WHERE id_delivery = $1 LIMIT 1`,
      [id_delivery]
    );
    return r.rows[0] || null;
  }

  static async revertPayout(conn, id_delivery) {
    const r = await conn.query(
      `UPDATE public.tb_community_delivery_payout
          SET status = 'revertido', reverted_at = NOW(), updated_at = NOW()
        WHERE id_delivery = $1 AND status IN ('aguardando', 'aprovado')
        RETURNING *`,
      [id_delivery]
    );
    return r.rows[0] || null;
  }

  static async listPayoutsForCourier(conn, id_courier, { limit = 100, offset = 0 } = {}) {
    const r = await conn.query(
      `SELECT p.*, c.display_name AS community_name
         FROM public.tb_community_delivery_payout p
         JOIN public.tb_profile c ON c.id_profile = p.id_community
        WHERE p.id_courier = $1
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3`,
      [id_courier, limit, offset]
    );
    return r.rows;
  }

  static async summaryForCourier(conn, id_courier) {
    const r = await conn.query(
      `SELECT
          COALESCE(SUM(CASE WHEN status='aguardando' THEN net_cents END), 0)::int AS aguardando_cents,
          COALESCE(SUM(CASE WHEN status='aprovado'   THEN net_cents END), 0)::int AS aprovado_cents,
          COALESCE(SUM(CASE WHEN status='pago'       THEN net_cents END), 0)::int AS pago_cents,
          COALESCE(SUM(CASE WHEN status='revertido'  THEN net_cents END), 0)::int AS revertido_cents,
          COUNT(*) FILTER (WHERE status IN ('aprovado','pago'))::int AS corridas
         FROM public.tb_community_delivery_payout
        WHERE id_courier = $1`,
      [id_courier]
    );
    return r.rows[0];
  }

  /* ------------------------------- o freio ------------------------------- */

  static async addStrike(conn, { id_user, id_community, id_delivery }) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_delivery_strike (id_user, id_community, id_delivery)
       VALUES ($1, $2, $3)
       RETURNING id_strike, created_at`,
      [id_user, id_community ?? null, id_delivery ?? null]
    );
    return r.rows[0];
  }

  /**
   * Quantos cancelamentos na janela, e quando o mais recente aconteceu.
   *
   * ⚠️ A JANELA VEM COMO PARÂMETRO EM DIAS e vira intervalo por multiplicação,
   * não por interpolação de string: `INTERVAL '$1 days'` não existe em SQL
   * (o literal não é parametrizável), e concatenar o número na query seria
   * injeção por um caminho que ninguém audita.
   */
  static async countRecentStrikes(conn, id_user, windowDays) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n, MAX(created_at) AS last_at
         FROM public.tb_community_delivery_strike
        WHERE id_user = $1
          AND created_at >= NOW() - ($2::int * INTERVAL '1 day')`,
      [id_user, windowDays]
    );
    return { count: r.rows[0]?.n || 0, last_at: r.rows[0]?.last_at || null };
  }

  /* --------------------------- disponível agora -------------------------- */

  static async setAvailability(conn, id_community, id_user, is_available) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_delivery_availability (id_community, id_user, is_available)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_community, id_user) DO UPDATE
         SET is_available = EXCLUDED.is_available, updated_at = NOW()
       RETURNING *`,
      [id_community, id_user, is_available]
    );
    return r.rows[0];
  }

  static async getAvailability(conn, id_community, id_user) {
    const r = await conn.query(
      `SELECT is_available FROM public.tb_community_delivery_availability
        WHERE id_community = $1 AND id_user = $2 LIMIT 1`,
      [id_community, id_user]
    );
    return r.rowCount ? !!r.rows[0].is_available : false;
  }

  /**
   * Quem pediu para ser avisado quando abrir um chamado.
   *
   * ⚠️ Quem ABRIU o chamado fica de fora (`<> $2`): avisar a própria pessoa de
   * que ela abriu um chamado é a notificação mais inútil possível — e o
   * `safeNotify` já a descartaria, mas é melhor não gerar do que descartar.
   */
  static async listAvailableUserIds(conn, id_community, exceptUserId) {
    const r = await conn.query(
      `SELECT id_user FROM public.tb_community_delivery_availability
        WHERE id_community = $1 AND is_available = TRUE AND id_user <> $2`,
      [id_community, exceptUserId]
    );
    return r.rows.map((x) => x.id_user);
  }
}

module.exports = CommunityDeliveryStorage;
