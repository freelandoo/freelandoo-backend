// src/services/SpaceSlotService.js
// Pet e carro ADICIONAIS (mig 264): o primeiro de cada é grátis; do segundo em
// diante, R$9,99 vitalício — o MESMO preço do perfil adicional, lido da mesma
// linha (`tb_annual_fee_settings`), para o admin mudar num lugar só.
//
// ─── O PAGAMENTO É A EXISTÊNCIA ─────────────────────────────────────────────
//
// O confirmador do webhook já CRIA o espaço vazio (o mesmo que o menu da foto
// cria de graça) e grava o id na linha da compra. A tela de retorno lê essa
// linha pelo session id e leva a pessoa direto para a página nova. A
// alternativa — pagar, voltar e apertar "criar" de novo — deixaria um passo
// que, esquecido, é dinheiro pago sem nada entregue.
//
// ─── O LIMITE CONTA ESPAÇOS VIVOS ───────────────────────────────────────────
//
// `vivos < 1 + vagas pagas`. Apagar um pet libera a vaga: quem pagou por um
// segundo cachorro e o removeu pode cadastrar outro sem pagar de novo.
//
// ⚠️ Estorno TOTAL tira a vaga, mas NÃO apaga o espaço criado com ela: apagar
// conteúdo de alguém por causa de um estorno é o tipo de efeito colateral que
// ninguém espera. O efeito é só a pessoa não conseguir criar o próximo.

const pool = require("../databases");
const PaymentGateway = require("../integrations/payments");
const AnnualFeeSettingsStorage = require("../storages/AnnualFeeSettingsStorage");
const SpaceSlotStorage = require("../storages/SpaceSlotStorage");
const { isFullRefund } = require("../utils/refunds");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("SpaceSlotService");

const FREE_PER_KIND = 1;
const LABEL = Object.freeze({ pet: "Pet adicional", car: "Carro adicional" });

class SpaceSlotService {
  static get FREE_PER_KIND() {
    return FREE_PER_KIND;
  }

  static async price() {
    const settings = await AnnualFeeSettingsStorage.get(pool);
    return Number(settings?.amount_cents) || 0;
  }

  /**
   * Pode criar mais um? Roda DENTRO da transação de criação, depois do lock,
   * para que dois cliques simultâneos não passem os dois pelo mesmo limite.
   * Devolve `null` quando pode; senão o corpo da recusa (402).
   */
  static async assertCanCreate(client, id_user, kind) {
    await SpaceSlotStorage.lockUserKind(client, id_user, kind);
    const live = await SpaceSlotStorage.countLiveSpaces(client, id_user, kind);
    const paid = await SpaceSlotStorage.countPaidSlots(client, id_user, kind);
    if (live < FREE_PER_KIND + paid) return null;
    const price_cents = await this.price();
    return {
      error:
        kind === "pet"
          ? "Seu primeiro pet é grátis. Cada pet a mais custa R$ 9,99, uma vez só."
          : "Seu primeiro carro é grátis. Cada carro a mais custa R$ 9,99, uma vez só.",
      statusCode: 402,
      needs_slot: true,
      kind,
      price_cents,
    };
  }

  /** O que a tela precisa para desenhar o "+": grátis ou pago, e quanto. */
  static async status(user, kind) {
    return runWithLogs(log, "status", () => ({ id_user: user?.id_user, kind }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!SpaceSlotStorage.KINDS.includes(kind)) return { error: "Modalidade inválida" };
      const live = await SpaceSlotStorage.countLiveSpaces(pool, user.id_user, kind);
      const paid = await SpaceSlotStorage.countPaidSlots(pool, user.id_user, kind);
      return {
        kind,
        live,
        paid_slots: paid,
        free_left: Math.max(0, FREE_PER_KIND + paid - live),
        price_cents: await this.price(),
      };
    });
  }

  static async createCheckout(user, body = {}) {
    return runWithLogs(log, "createCheckout", () => ({ id_user: user?.id_user, kind: body?.kind }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const kind = String(body.kind || "");
      if (!SpaceSlotStorage.KINDS.includes(kind)) return { error: "Modalidade inválida" };

      const live = await SpaceSlotStorage.countLiveSpaces(pool, user.id_user, kind);
      const paid = await SpaceSlotStorage.countPaidSlots(pool, user.id_user, kind);
      if (live < FREE_PER_KIND + paid) {
        // Cobrar quem ainda pode criar de graça seria vender o que já é dela.
        return { error: "Você ainda pode criar este de graça.", statusCode: 409 };
      }

      const amount_cents = await this.price();
      if (!amount_cents) return { error: "Preço ainda não configurado.", statusCode: 500 };

      const frontend = String(process.env.FRONTEND_URL || "https://www.freelandoo.com.br").replace(/\/$/, "");
      const session = await PaymentGateway.createCheckout({
        amount_cents,
        currency: "BRL",
        productName: `${LABEL[kind]} — Freelandoo`,
        customerEmail: user.email || undefined,
        clientReferenceId: user.id_user,
        successUrl: `${frontend}/espaco-adicional?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${frontend}/account?espaco=cancelado`,
        metadata: { type: "space_slot", user_id: String(user.id_user), kind },
      });

      await SpaceSlotStorage.createPurchase(pool, {
        id_user: user.id_user,
        kind,
        amount_cents,
        stripe_session_id: session.id,
      });

      return { checkout_url: session.url, session_id: session.id };
    });
  }

  /** A tela de retorno pergunta: já caiu? E qual espaço nasceu? */
  static async getBySession(user, session_id) {
    return runWithLogs(log, "getBySession", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const row = await SpaceSlotStorage.getBySession(pool, String(session_id || ""));
      if (!row || String(row.id_user) !== String(user.id_user)) {
        return { error: "Compra não encontrada", statusCode: 404 };
      }
      return {
        kind: row.kind,
        status: row.status,
        id_profile: row.id_profile || null,
      };
    });
  }

  /**
   * Webhook: idempotente por session id. Marca a vaga paga e cria o espaço
   * vazio na MESMA transação — pago sem espaço, ou espaço sem pagamento, são
   * os dois estados que não podem existir.
   */
  static async confirmStripeSession(session) {
    const meta = session.metadata || {};
    if (meta.type !== "space_slot") return { ignored: true };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let purchase = await SpaceSlotStorage.getBySession(client, session.id, { forUpdate: true });
      if (purchase && purchase.status === "paid") {
        await client.query("COMMIT");
        return { purchase, duplicate: true };
      }
      if (!purchase) {
        // Webhook chegou antes/no lugar da linha pendente (retry, reconciliação).
        if (!meta.user_id || !SpaceSlotStorage.KINDS.includes(meta.kind)) {
          await client.query("ROLLBACK");
          log.warn("confirm.bad_metadata", { session_id: session.id });
          return { error: "metadata_invalida" };
        }
        purchase = await SpaceSlotStorage.createPurchase(client, {
          id_user: meta.user_id,
          kind: meta.kind,
          amount_cents: session.amount_total ?? 0,
          stripe_session_id: session.id,
        });
      }

      const paymentIntent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null;

      // Require tardio: o SubjectCommunityService importa este arquivo.
      const SubjectCommunityService = require("./SubjectCommunityService");
      const community = await SubjectCommunityService.createEmptySpace(client, {
        id_user: purchase.id_user,
        kind: purchase.kind,
      });

      purchase = await SpaceSlotStorage.markPaid(client, purchase.id, {
        stripe_payment_intent: paymentIntent,
        id_profile: community.id_profile,
      });
      await client.query("COMMIT");
      log.info("slot.paid", {
        id_user: purchase.id_user,
        kind: purchase.kind,
        id_profile: purchase.id_profile,
      });
      return { purchase };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  static async expireBySession(stripe_session_id) {
    return SpaceSlotStorage.markExpiredBySession(pool, stripe_session_id);
  }

  static async handleChargeRefunded(charge) {
    const ref =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id || null;
    if (!ref) return { ignored: true };
    const purchase = await SpaceSlotStorage.getByPaymentIntent(pool, ref);
    if (!purchase) return { ignored: true };
    if (!isFullRefund(charge)) return { handled: false, partial: true };
    if (purchase.refunded_at) return { handled: true, duplicate: true };
    await SpaceSlotStorage.markRefunded(pool, purchase.id);
    log.info("slot.refunded", { id: purchase.id, id_user: purchase.id_user });
    return { handled: true };
  }
}

module.exports = SpaceSlotService;
