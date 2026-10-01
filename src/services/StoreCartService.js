// src/services/StoreCartService.js
// O CARRINHO DA LOJA (mig 271): vários produtos do MESMO vendedor, UM
// pagamento no Mercado Pago, e quem compra NÃO precisa de conta.
//
// Nasceu para o site da Pinkoracats ("temos que usar o mercado pago para que as
// pessoas possam comprar as unhas"), mas não sabe nada de tema: qualquer site
// que tenha um carrinho chama a mesma porta.
//
// ═══ O QUE ELE REUSA, E POR QUÊ ═══
//
// Cada item vira uma linha de `tb_profile_product_order` (com `id_cart`). Com
// isso o saldo do vendedor com holdback (1 por pedido), o "retirado", o extrato
// e o painel de admin continuam funcionando sem uma linha de mudança. A taxa é
// a MESMA régua da Loja avulsa (`StoreGovernanceService.computeFeesFor`) — o
// preço que o site mostra é o `display_price_cents` dela, e o carrinho não pode
// cobrar outro.
//
// ═══ AS REGRAS QUE NÃO PODEM REGREDIR ═══
//
// • SÓ RETIRADA (mig 264). O comprador paga e combina a retirada; não há frete.
// • O PREÇO É RECALCULADO AQUI, NUNCA LIDO DO CORPO. O carrinho mora no
//   navegador; um preço vindo dele seria o cliente escolhendo quanto pagar.
// • A REFERÊNCIA DE PAGAMENTO MORA SÓ NO CARRINHO. Os filhos ficam sem ela, e o
//   estorno de carrinho roda ANTES do da Loja avulsa na cadeia do webhook — ver
//   a mig 271.
// • O ESTOQUE SÓ CAI QUANDO O PAGAMENTO CONFIRMA, e cai TUDO OU NADA: se um
//   item esgotou entre o checkout e o webhook, o carrinho inteiro é cancelado e
//   o dinheiro volta. Entregar metade de um pedido pago inteiro seria o pior
//   dos dois mundos (cobrado e incompleto).
// • A URL DE RETORNO É CONFERIDA. Ela vem do navegador; sem conferência, a
//   página de pagamento devolveria a pessoa para onde quem montou o pedido
//   quisesse (redirect aberto com a nossa marca).

const pool = require("../databases");
const ProfileProductStorage = require("../storages/ProfileProductStorage");
const ProfileProductOrderStorage = require("../storages/ProfileProductOrderStorage");
const SellerBalanceStorage = require("../storages/SellerBalanceStorage");
const StoreCartStorage = require("../storages/StoreCartStorage");
const StoreGovernanceService = require("./StoreGovernanceService");
const NotificationService = require("./NotificationService");
const PaymentGateway = require("../integrations/payments");
const { providerOf } = require("../integrations/payments/contract");
const { isFullRefund } = require("../utils/refunds");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("StoreCartService");

const HOLDBACK_DAYS = 8;
const MAX_LINES = 20;
const MAX_QTY = 99;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Hosts que são da plataforma: tudo sob freelandoo.com.br é nosso. */
const PLATFORM_ROOT = "freelandoo.com.br";

function clean(v, max) {
  if (v == null) return "";
  return String(v).replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * O cliente compra sem conta — então o que identifica o pedido é o que ele
 * digita. Nome, e-mail e WhatsApp são os três canais de quem vai combinar a
 * retirada; sem o WhatsApp, a dona teria só um e-mail para combinar um encontro.
 */
function validateBuyer(raw = {}) {
  const name = clean(raw.name, 160);
  const email = clean(raw.email, 160).toLowerCase();
  const whatsapp = String(raw.whatsapp || "").replace(/\D/g, "");
  if (name.length < 2) return { error: "Informe seu nome." };
  if (!EMAIL_RE.test(email)) return { error: "Informe um e-mail válido." };
  if (whatsapp.length < 10 || whatsapp.length > 13) {
    return { error: "Informe um WhatsApp com DDD." };
  }
  return { buyer: { name, email, whatsapp } };
}

/** Itens repetidos viram uma linha só; quantidade fora da faixa é recusada. */
function normalizeItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "O carrinho está vazio." };
  const map = new Map();
  for (const it of raw) {
    const id = Number(it?.id_profile_product);
    const qty = Math.floor(Number(it?.quantity));
    if (!Number.isInteger(id) || id <= 0) return { error: "Produto inválido no carrinho." };
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return { error: "Quantidade inválida no carrinho." };
    }
    map.set(id, (map.get(id) || 0) + qty);
  }
  if (map.size > MAX_LINES) return { error: `No máximo ${MAX_LINES} produtos por pedido.` };
  for (const qty of map.values()) {
    if (qty > MAX_QTY) return { error: "Quantidade inválida no carrinho." };
  }
  return { items: [...map.entries()].map(([id, qty]) => ({ id_profile_product: id, quantity: qty })) };
}

/**
 * A URL de retorno só vale se for nossa ou do site desta comunidade.
 *
 * Nossa = qualquer host sob freelandoo.com.br (a plataforma, `/c/<slug>` e o
 * subdomínio do site). Do site = domínio próprio ATIVO desta comunidade. Fora
 * disso, `null` — e quem chama cai no endereço da plataforma.
 */
async function safeReturnUrl(raw, id_community) {
  if (!raw || typeof raw !== "string") return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const ours = host === PLATFORM_ROOT || host.endsWith(`.${PLATFORM_ROOT}`);
  const devHost = process.env.NODE_ENV !== "production" && (host === "localhost" || host === "127.0.0.1");
  if (!ours && !devHost) {
    if (!id_community) return null;
    const r = await pool.query(
      `SELECT 1 FROM public.tb_community_domain
        WHERE id_profile = $1 AND domain = $2 AND status = 'active' LIMIT 1`,
      [id_community, host]
    );
    if (r.rowCount === 0) return null;
  }
  // Só origem + caminho: query e fragmento antigos sairiam carregando um
  // `?pedido=` de outra compra.
  return `${url.origin}${url.pathname}`;
}

function withParams(base, params) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * Reparte a tarifa REAL do gateway entre os pedidos-filhos, na proporção do que
 * cada um custou. A sobra do arredondamento vai para o último — sem dono, um
 * centavo ficaria fora da soma e os filhos deixariam de fechar com a tarifa.
 */
function splitFee(feeCents, orders) {
  const total = orders.reduce((s, o) => s + (Number(o.total_cents) || 0), 0);
  if (!total) return orders.map(() => 0);
  let given = 0;
  return orders.map((o, i) => {
    if (i === orders.length - 1) return Math.max(0, feeCents - given);
    const part = Math.floor((feeCents * (Number(o.total_cents) || 0)) / total);
    given += part;
    return part;
  });
}

class StoreCartService {
  /**
   * Monta o carrinho e devolve a página de pagamento do Mercado Pago.
   *
   * `user` é opcional: logado, o pedido fica ligado à conta (aparece em
   * "minhas compras"); convidado, o pedido vive pelos dados digitados.
   */
  static async createCheckout(user, body = {}) {
    return runWithLogs(
      log,
      "createCheckout",
      () => ({ id_user: user?.id_user || null, lines: Array.isArray(body?.items) ? body.items.length : 0 }),
      async () => {
        const b = validateBuyer(body.buyer);
        if (b.error) return { error: b.error };
        const n = normalizeItems(body.items);
        if (n.error) return { error: n.error };

        const id_community = UUID_RE.test(String(body.id_community || "")) ? String(body.id_community) : null;

        // ── os produtos, lidos do banco e conferidos um a um ─────────────────
        const lines = [];
        let seller = null;
        for (const it of n.items) {
          const p = await ProfileProductStorage.getWithOwner(pool, it.id_profile_product);
          if (!p || !p.is_active || p.deleted_at || p.moderation_status !== "active" || p.profile_is_clan) {
            return { error: "Um dos produtos não está mais à venda.", statusCode: 409 };
          }
          if (!p.profile_is_paid) return { error: "Loja indisponível.", statusCode: 409 };
          if (seller && String(seller.id_profile) !== String(p.id_profile)) {
            return { error: "O carrinho tem produtos de lojas diferentes." };
          }
          seller = seller || { id_profile: p.id_profile, id_user: p.owner_id_user };
          if (Number(p.stock_quantity) < it.quantity) {
            return {
              error: `Só restam ${Math.max(0, Number(p.stock_quantity) || 0)} de "${p.name}".`,
              statusCode: 409,
            };
          }
          const pricing = await StoreGovernanceService.computeFeesFor(Number(p.price_amount) || 0, {
            affiliatesAllowed: p.affiliates_allowed === true,
            affiliatePercent: p.affiliate_percent,
          });
          lines.push({ product: p, quantity: it.quantity, pricing });
        }

        if (user?.id_user && String(seller.id_user) === String(user.id_user)) {
          return { error: "Você não pode comprar os seus próprios produtos." };
        }

        const total_cents = lines.reduce((s, l) => s + l.pricing.display_price_cents * l.quantity, 0);
        if (total_cents <= 0) return { error: "Pedido sem valor." };

        // A comunidade só conta se a Loja for do líder dela — é ela que valida
        // o domínio próprio da URL de retorno.
        let community = null;
        if (id_community) {
          const r = await pool.query(
            `SELECT p.id_profile, p.community_site_slug, p.id_leader_user
               FROM public.tb_profile p
              WHERE p.id_profile = $1 AND p.is_community = TRUE AND p.deleted_at IS NULL`,
            [id_community]
          );
          const row = r.rows[0];
          if (row && String(row.id_leader_user) === String(seller.id_user)) community = row;
        }

        const frontend = String(process.env.FRONTEND_URL || "https://www.freelandoo.com.br").replace(/\/$/, "");
        const fallback = community?.community_site_slug
          ? `${frontend}/c/${community.community_site_slug}`
          : frontend;
        const returnBase = (await safeReturnUrl(body.return_url, community?.id_profile)) || fallback;

        // ── (1) o carrinho e os filhos, ANTES da rede ────────────────────────
        // Mesma ordem do PaymentGateway: invertido, uma falha no meio deixaria
        // a cobrança de pé no Mercado Pago sem linha nenhuma aqui.
        const client = await pool.connect();
        let cart;
        try {
          await client.query("BEGIN");
          cart = await StoreCartStorage.create(client, {
            id_seller_profile: seller.id_profile,
            id_seller_user: seller.id_user,
            id_buyer_user: user?.id_user || null,
            buyer_name: b.buyer.name,
            buyer_email: b.buyer.email,
            buyer_whatsapp: b.buyer.whatsapp,
            note: clean(body.note, 500) || null,
            items_count: lines.reduce((s, l) => s + l.quantity, 0),
            total_cents,
            id_community: community?.id_profile || null,
            return_url: returnBase,
          });
          for (const l of lines) {
            await StoreCartStorage.createOrder(client, {
              id_buyer_user: user?.id_user || null,
              id_profile_product: l.product.id_profile_product,
              id_seller_profile: seller.id_profile,
              id_seller_user: seller.id_user,
              quantity: l.quantity,
              unit_price_cents: l.pricing.display_price_cents,
              total_cents: l.pricing.display_price_cents * l.quantity,
              seller_amount_cents: (Number(l.product.price_amount) || 0) * l.quantity,
              service_fee_cents: (l.pricing.service_fee_cents || 0) * l.quantity,
              processor_fee_cents: (l.pricing.processor_fee_cents || 0) * l.quantity,
              buyer_name: b.buyer.name,
              buyer_email: b.buyer.email,
              buyer_whatsapp: b.buyer.whatsapp,
              id_cart: cart.id_cart,
            });
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        // ── (2) a cobrança ────────────────────────────────────────────────────
        try {
          const session = await PaymentGateway.createCheckout({
            flow: "store_cart",
            id_user: user?.id_user || null,
            amount_cents: total_cents,
            currency: "BRL",
            lineItems: lines.map((l) => ({
              name: `${l.product.name} (retirada com a vendedora)`.slice(0, 120),
              amount_cents: l.pricing.display_price_cents,
              quantity: l.quantity,
            })),
            customerEmail: b.buyer.email,
            successUrl: withParams(returnBase, { pedido: cart.id_cart }),
            cancelUrl: withParams(returnBase, { pedido: cart.id_cart, pedido_status: "cancel" }),
            metadata: {
              type: "store_cart",
              id_cart: cart.id_cart,
              ...(user?.id_user ? { user_id: user.id_user } : {}),
            },
          });
          const charged = await StoreCartStorage.attachCharge(pool, cart.id_cart, {
            provider: providerOf(session),
            session_id: session.id,
            provider_ref: session.provider_ref || session.id,
            checkout_url: session.url || null,
          });
          return {
            id_cart: cart.id_cart,
            checkout_url: session.url,
            total_cents,
            cart: charged ? { id_cart: charged.id_cart, status: charged.status } : null,
          };
        } catch (err) {
          log.error("cart.charge.fail", { id_cart: cart.id_cart, message: err?.message });
          await StoreCartStorage.markCanceled(pool, cart.id_cart);
          return { error: "Não foi possível iniciar o pagamento. Tente de novo.", statusCode: 502 };
        }
      }
    );
  }

  /**
   * O webhook confirmou o pagamento. Idempotente: reentrega devolve `already`.
   *
   * Ordem: trava o carrinho → baixa o estoque de TODOS os itens (tudo ou
   * nada) → marca os filhos pagos → reparte a tarifa real → escreve o saldo de
   * cada filho com holdback → marca o carrinho pago.
   */
  static async confirmStripeSession(session) {
    const meta = session.metadata || {};
    if (meta.type !== "store_cart") return { ignored: true };
    const id_cart = String(meta.id_cart || "");
    if (!UUID_RE.test(id_cart)) return { error: "id_cart inválido" };

    const payment_intent_id =
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;

    let fee = null;
    if (payment_intent_id) {
      try {
        const f = await PaymentGateway.getChargeFee(payment_intent_id);
        // `null` é "não deu para apurar" — a estimativa fica de pé. Tratar
        // como zero pagaria ao vendedor dinheiro que o gateway já reteve.
        if (Number.isFinite(f?.fee_cents)) fee = { cents: Math.max(0, Math.round(f.fee_cents)), source: f.source, charge_id: f.charge_id || null };
      } catch (err) {
        log.warn("confirm.fee_lookup_fail", { id_cart, message: err?.message });
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cart = await StoreCartStorage.lockById(client, id_cart);
      if (!cart) {
        await client.query("ROLLBACK");
        log.warn("confirm.cart_not_found", { id_cart });
        return { error: "cart_not_found" };
      }
      if (cart.status !== "pending") {
        await client.query("COMMIT");
        return { already: true, cart };
      }

      const orders = await StoreCartStorage.listOrders(client, id_cart);
      for (const o of orders) {
        const ok = await ProfileProductStorage.decrementStock(client, o.id_profile_product, o.quantity);
        if (!ok) {
          // Um item esgotou entre o checkout e o pagamento: desfaz as baixas
          // que já aconteceram, cancela tudo e devolve o dinheiro inteiro.
          await client.query("ROLLBACK");
          await StoreCartStorage.markCanceled(pool, id_cart, {
            payment_intent_id,
            charge_id: fee?.charge_id || null,
          });
          log.warn("confirm.out_of_stock_canceled", { id_cart, id_order: o.id_order });
          try {
            if (payment_intent_id) await PaymentGateway.refund({ payment_intent_id });
            else log.error("confirm.refund_no_ref", { id_cart });
          } catch (err) {
            log.error("confirm.refund_fail", { id_cart, message: err?.message });
          }
          return { error: "out_of_stock", canceled: true };
        }
      }

      const shares = fee ? splitFee(fee.cents, orders) : null;
      const available_at = new Date(Date.now() + HOLDBACK_DAYS * 86400000);
      const paidOrders = [];
      for (let i = 0; i < orders.length; i += 1) {
        let paid = await StoreCartStorage.markOrderPaid(client, orders[i].id_order);
        if (!paid) continue;
        if (shares && fee.source) {
          const settled = await ProfileProductOrderStorage.settleProcessorFee(
            client,
            paid.id_order,
            shares[i],
            fee.source
          );
          if (settled) paid = settled;
        }
        // O vendedor recebe o `seller_amount_cents` cravado no checkout; a
        // diferença entre tarifa estimada e real é da plataforma (mesma regra
        // da Loja avulsa).
        await SellerBalanceStorage.create(client, {
          id_seller_user: paid.id_seller_user,
          id_seller_profile: paid.id_seller_profile,
          id_order: paid.id_order,
          gross_cents: Number(paid.total_cents) || 0,
          platform_fee_cents: Number(paid.service_fee_cents) || 0,
          shipping_cents: 0,
          net_cents: Number(paid.seller_amount_cents) || 0,
          status: "aguardando",
          available_at,
        });
        paidOrders.push(paid);
      }

      const paidCart = await StoreCartStorage.markPaid(client, id_cart, {
        payment_intent_id,
        charge_id: fee?.charge_id || null,
      });
      await client.query("COMMIT");

      const net = paidOrders.reduce((s, o) => s + (Number(o.seller_amount_cents) || 0), 0);
      NotificationService.notifyProductSale({
        seller_user_id: cart.id_seller_user,
        seller_profile_id: cart.id_seller_profile,
        buyer_user_id: cart.id_buyer_user || null,
        id_order: cart.id_cart,
        amount_cents: net,
        product_title: `Pedido de ${cart.buyer_name} — ${cart.items_count} ${cart.items_count === 1 ? "item" : "itens"} (retirada)`,
      }).catch(() => {});

      // Logado, a conversa de retirada abre sozinha, como na Loja avulsa. O
      // convidado não tem caixa de mensagens: a vendedora vê nome, e-mail e
      // WhatsApp dele em "minhas vendas".
      if (cart.id_buyer_user) {
        setImmediate(() => {
          StoreCartService._openPickupConversation(paidCart || cart, paidOrders).catch((err) => {
            log.warn("confirm.pickup_chat_fail", { id_cart, message: err?.message });
          });
        });
      }

      return { cart: paidCart, orders: paidOrders };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* já desfeito */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  static async _openPickupConversation(cart, orders) {
    const InboxDropService = require("./InboxDropService");
    const items = orders.map((o) => `${Number(o.quantity) > 1 ? `${o.quantity}× ` : ""}${o.product_name || "produto"}`);
    const text =
      `Olá! Acabei de comprar ${items.join(", ")} pela Freelandoo ` +
      `(pedido ${String(cart.id_cart).slice(0, 8)}). Quando e onde posso retirar?`;
    return InboxDropService.send({
      from_user_id: cart.id_buyer_user,
      to_user_id: cart.id_seller_user,
      to_profile_id: cart.id_seller_profile,
      text,
    });
  }

  /** Página de pagamento abandonada: o carrinho e os filhos viram cancelados. */
  static async expireBySession(session_id) {
    const cart = await StoreCartStorage.getBySession(pool, session_id);
    if (!cart || cart.status !== "pending") return false;
    const row = await StoreCartStorage.markCanceled(pool, cart.id_cart);
    return !!row;
  }

  /**
   * Estorno TOTAL do carrinho: devolve o estoque do que estava pago, reverte o
   * saldo de cada filho e marca tudo como reembolsado. Parcial é ignorado (não
   * dá para saber de qual item ele é).
   */
  static async handleChargeRefunded(charge) {
    const ref =
      typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id || null;
    const cart = await StoreCartStorage.getByPaymentRef(pool, ref || charge.id);
    if (!cart) return { ignored: true };

    if (!isFullRefund(charge)) {
      log.warn("refund.partial_ignored", { id_cart: cart.id_cart, amount_refunded: charge.amount_refunded });
      return { handled: false, partial: true };
    }
    if (cart.status === "refunded") return { handled: true, duplicate: true };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const orders = await StoreCartStorage.listOrders(client, cart.id_cart);
      for (const o of orders) {
        if (o.status === "paid" || o.status === "shipped" || o.status === "delivered") {
          await client.query(
            `UPDATE public.tb_profile_product
                SET stock_quantity = stock_quantity + $2, updated_at = NOW()
              WHERE id_profile_product = $1`,
            [o.id_profile_product, o.quantity]
          );
          await SellerBalanceStorage.revertByOrder(client, o.id_order);
        }
      }
      await StoreCartStorage.markRefunded(client, cart.id_cart);
      await client.query("COMMIT");
      log.info("cart.refunded", { id_cart: cart.id_cart });
      return { handled: true };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * O recibo público, por id. O id é um UUID (não se adivinha), e a resposta é
   * enxuta: o primeiro nome de quem comprou, os itens e o estado. Nada de
   * e-mail, WhatsApp ou valor repassado.
   */
  static async getPublic(params) {
    const id_cart = String(params?.id_cart || "");
    if (!UUID_RE.test(id_cart)) return { error: "Pedido não encontrado", statusCode: 404 };
    const cart = await StoreCartStorage.getById(pool, id_cart);
    if (!cart) return { error: "Pedido não encontrado", statusCode: 404 };
    const orders = await StoreCartStorage.listOrders(pool, id_cart);
    const seller = await pool.query(
      `SELECT display_name FROM public.tb_profile WHERE id_profile = $1`,
      [cart.id_seller_profile]
    );
    return {
      cart: {
        id_cart: cart.id_cart,
        status: cart.status,
        total_cents: Number(cart.total_cents) || 0,
        items_count: Number(cart.items_count) || 0,
        buyer_first_name: String(cart.buyer_name || "").split(" ")[0] || null,
        seller_name: seller.rows[0]?.display_name || null,
        created_at: cart.created_at,
        paid_at: cart.paid_at,
        items: orders.map((o) => ({
          id_profile_product: Number(o.id_profile_product),
          name: o.product_name,
          quantity: Number(o.quantity) || 0,
          unit_price_cents: Number(o.unit_price_cents) || 0,
          cover_url: o.product_cover_url || null,
          status: o.status,
        })),
      },
    };
  }
}

module.exports = StoreCartService;
module.exports._internal = { validateBuyer, normalizeItems, splitFee };
