// src/services/CommunityListingService.js
// As VITRINES das comunidades territoriais (mig 198): quadro de SERVIÇOS e de
// PRODUTOS dos moradores, com cota grátis e venda de vagas extras.
//
// ─── ELA JÁ EXISTIA, E SÓ SERVIA CONDOMÍNIO ─────────────────────────────────
//
// A mig 198 construiu exatamente a vitrine que o bairro precisava — tipo
// (serviço|produto), título, descrição, preço, contato, foto, cota por tipo e
// vaga extra paga. O que faltava era ela ATENDER as duas modalidades
// territoriais e ser uma ABA, em vez de viver escondida no bloco de extras do
// condomínio, entre avisos e enquetes.
//
// Construir uma tabela nova para o bairro teria sido a segunda verdade sobre a
// mesma coisa: dois lugares para "o que os vizinhos oferecem", divergindo na
// primeira regra nova. Por isso aqui se generaliza o SERVICE, e o nome físico
// da tabela fica como está (ver o cabeçalho do storage).
//
// ⚠️ QUEM PODE VER E PUBLICAR É O MORADOR, e o predicado difere por
// modalidade — condomínio pede unidade confirmada, bairro pede reconhecimento
// dos vizinhos. As duas respostas moram em `utils/territorialCommunity.js`,
// escritas uma vez: escrever o guard aqui recriaria a divergência que já fez
// aviso direcionado não chegar em morador novo.
//
// A cobrança da VAGA EXTRA segue o padrão de pagamento já usado no projeto:
// `price_data` ad-hoc (sem Product/Price no dashboard), confirmação idempotente
// por session id no webhook, expiração de sessão e reversão em charge.refunded
// — mais o caminho alternativo em Poléns (mig 195). Quem recebe é a PLATAFORMA
// (não o síndico): é venda de espaço da Freelandoo, como o ingresso de
// comunidade.

const pool = require("../databases");
const CommunityListingStorage = require("../storages/CommunityListingStorage");
const PolenStorage = require("../storages/PolenStorage");
const PaymentGateway = require("../integrations/payments");
const { providerOf } = require("../integrations/payments/contract");
const { isFullRefund } = require("../utils/refunds");
const { territorialContext } = require("../utils/territorialCommunity");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CommunityListingService");

const KINDS = ["service", "product"];
const MAX_TITLE = 120;
const MAX_DESC = 2000;
const MAX_CONTACT = 120;
const MAX_SLOTS_PER_PURCHASE = 10;

/**
 * O id da comunidade, venha ele da rota nova ou da antiga.
 *
 * As duas portas continuam montadas de propósito (`/communities/:id_profile` é
 * a genérica; `/condos/:id_condo` é a que o front em cache ainda chama). Um
 * service por rota seria o mesmo produto em dois lugares — a divergência de
 * sempre. Aqui elas entram pelo mesmo lugar e só o nome do parâmetro muda.
 */
function communityIdOf(params) {
  return params?.id_profile || params?.id_condo || null;
}

function clean(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function freeQuotaFor(settings, kind) {
  return kind === "service"
    ? settings.free_service_listings
    : settings.free_product_listings;
}

class CommunityListingService {
  /* ------------------------------- leitura ------------------------------- */

  static async list(user, params, query) {
    return runWithLogs(
      log,
      "list",
      () => ({ id_user: user?.id_user, id_condo: communityIdOf(params), kind: query?.kind }),
      async () => {
        // Quadro é área interna: precisa ser morador confirmado.
        const ctx = await territorialContext(pool, user?.id_user, communityIdOf(params), {
          require: "resident",
        });
        if (ctx.error) return ctx;

        const kind = KINDS.includes(query?.kind) ? query.kind : null;
        const listings = await CommunityListingStorage.list(pool, communityIdOf(params), {
          kind,
          status: query?.mine === "1" ? "all" : "active",
          id_user: query?.mine === "1" ? user.id_user : null,
          limit: query?.limit,
          offset: query?.offset,
        });
        return { listings };
      }
    );
  }

  // Quanto ainda dá pra publicar de graça, quanto custa a vaga extra e quantas
  // o morador já comprou. É o que a tela mostra antes do botão "Publicar".
  static async getQuota(user, params, query) {
    return runWithLogs(
      log,
      "getQuota",
      () => ({ id_user: user?.id_user, id_condo: communityIdOf(params) }),
      async () => {
        const ctx = await territorialContext(pool, user?.id_user, communityIdOf(params), {
          require: "resident",
        });
        if (ctx.error) return ctx;

        const settings = await CommunityListingStorage.getEffectiveSettings(pool, communityIdOf(params));
        const kinds = KINDS.includes(query?.kind) ? [query.kind] : KINDS;

        const quota = {};
        for (const kind of kinds) {
          const [used, purchased] = await Promise.all([
            CommunityListingStorage.countActive(pool, communityIdOf(params), user.id_user, kind),
            CommunityListingStorage.countPaidSlots(pool, communityIdOf(params), user.id_user, kind),
          ]);
          const free = freeQuotaFor(settings, kind);
          quota[kind] = {
            free,
            purchased,
            used,
            total: free + purchased,
            remaining: Math.max(0, free + purchased - used),
          };
        }

        return {
          quota,
          price_cents: settings.extra_slot_price_cents,
          price_polens: settings.extra_slot_price_polens,
        };
      }
    );
  }

  /* ------------------------------ publicação ----------------------------- */

  static async create(user, params, body) {
    return runWithLogs(
      log,
      "create",
      () => ({ id_user: user?.id_user, id_condo: communityIdOf(params), kind: body?.kind }),
      async () => {
        const ctx = await territorialContext(pool, user?.id_user, communityIdOf(params), {
          require: "resident",
        });
        if (ctx.error) return ctx;

        const kind = KINDS.includes(body?.kind) ? body.kind : null;
        if (!kind) return { error: "Tipo inválido (service|product).", statusCode: 400 };

        const title = clean(body?.title, MAX_TITLE);
        if (!title) return { error: "Dê um título ao anúncio.", statusCode: 400 };

        const price =
          body?.price_cents === undefined || body?.price_cents === null || body?.price_cents === ""
            ? null
            : Math.max(0, Math.round(Number(body.price_cents) || 0));

        // Cota: grátis + vagas compradas − ativos. Estourou, o front manda
        // pro checkout de vaga extra (o erro devolve o preço junto).
        const settings = await CommunityListingStorage.getEffectiveSettings(pool, communityIdOf(params));
        const free = freeQuotaFor(settings, kind);
        const purchased = await CommunityListingStorage.countPaidSlots(
          pool,
          communityIdOf(params),
          user.id_user,
          kind
        );
        const used = await CommunityListingStorage.countActive(
          pool,
          communityIdOf(params),
          user.id_user,
          kind
        );
        if (used >= free + purchased) {
          return {
            error: "Você atingiu o limite de anúncios ativos. Compre uma vaga extra para publicar mais.",
            statusCode: 402,
            needs_slot: true,
            kind,
            free,
            purchased,
            used,
            price_cents: settings.extra_slot_price_cents,
            price_polens: settings.extra_slot_price_polens,
          };
        }

        const listing = await CommunityListingStorage.create(pool, {
          id_condo: communityIdOf(params),
          id_user: user.id_user,
          kind,
          title,
          description: clean(body?.description, MAX_DESC),
          price_cents: price,
          contact: clean(body?.contact, MAX_CONTACT),
          image_url: clean(body?.image_url, 500),
        });
        return { listing };
      }
    );
  }

  static async update(user, params, body) {
    return runWithLogs(
      log,
      "update",
      () => ({ id_user: user?.id_user, id_listing: params?.id_listing }),
      async () => {
        const ctx = await territorialContext(pool, user?.id_user, communityIdOf(params), {
          require: "resident",
        });
        if (ctx.error) return ctx;

        const listing = await CommunityListingStorage.getById(pool, communityIdOf(params), params.id_listing);
        if (!listing) return { error: "Anúncio não encontrado", statusCode: 404 };
        if (String(listing.id_user) !== String(user.id_user)) {
          return { error: "Este anúncio não é seu.", statusCode: 403 };
        }

        const fields = {};
        if (body?.title !== undefined) fields.title = clean(body.title, MAX_TITLE);
        if (body?.description !== undefined) fields.description = clean(body.description, MAX_DESC);
        if (body?.contact !== undefined) fields.contact = clean(body.contact, MAX_CONTACT);
        if (body?.image_url !== undefined) fields.image_url = clean(body.image_url, 500);
        if (body?.price_cents !== undefined) {
          fields.price_cents =
            body.price_cents === null || body.price_cents === ""
              ? null
              : Math.max(0, Math.round(Number(body.price_cents) || 0));
        }
        if (fields.title === null) return { error: "Dê um título ao anúncio.", statusCode: 400 };

        const updated = await CommunityListingStorage.update(
          pool,
          communityIdOf(params),
          params.id_listing,
          fields
        );
        return { listing: updated };
      }
    );
  }

  // Arquivar devolve a vaga: o limite é de anúncios ATIVOS.
  static async setStatus(user, params, body) {
    return runWithLogs(
      log,
      "setStatus",
      () => ({ id_user: user?.id_user, id_listing: params?.id_listing, status: body?.status }),
      async () => {
        const ctx = await territorialContext(pool, user?.id_user, communityIdOf(params), {
          require: "member",
        });
        if (ctx.error) return ctx;

        const listing = await CommunityListingStorage.getById(pool, communityIdOf(params), params.id_listing);
        if (!listing) return { error: "Anúncio não encontrado", statusCode: 404 };
        const isOwner = String(listing.id_user) === String(user.id_user);
        if (!isOwner && !ctx.isAdmin) {
          return { error: "Você não pode alterar este anúncio.", statusCode: 403 };
        }

        const status = body?.status === "active" ? "active" : "archived";

        // Reativar volta a consumir vaga — revalida a cota.
        if (status === "active") {
          const settings = await CommunityListingStorage.getEffectiveSettings(pool, communityIdOf(params));
          const free = freeQuotaFor(settings, listing.kind);
          const purchased = await CommunityListingStorage.countPaidSlots(
            pool,
            communityIdOf(params),
            listing.id_user,
            listing.kind
          );
          const used = await CommunityListingStorage.countActive(
            pool,
            communityIdOf(params),
            listing.id_user,
            listing.kind
          );
          if (used >= free + purchased) {
            return {
              error: "Limite de anúncios ativos atingido.",
              statusCode: 402,
              needs_slot: true,
              kind: listing.kind,
            };
          }
        }

        const row = await CommunityListingStorage.setStatus(
          pool,
          communityIdOf(params),
          params.id_listing,
          status
        );
        return row;
      }
    );
  }

  /* ---------------------------- vagas: dinheiro -------------------------- */

  static async createSlotCheckout(user, params, body) {
    return runWithLogs(
      log,
      "createSlotCheckout",
      () => ({ id_user: user?.id_user, id_condo: communityIdOf(params), kind: body?.kind }),
      async () => {
        const ctx = await territorialContext(pool, user?.id_user, communityIdOf(params), {
          require: "resident",
        });
        if (ctx.error) return ctx;

        const kind = KINDS.includes(body?.kind) ? body.kind : null;
        if (!kind) return { error: "Tipo inválido (service|product).", statusCode: 400 };

        const quantity = Math.min(
          MAX_SLOTS_PER_PURCHASE,
          Math.max(1, Math.round(Number(body?.quantity) || 1))
        );

        const settings = await CommunityListingStorage.getEffectiveSettings(pool, communityIdOf(params));
        const unit = Number(settings.extra_slot_price_cents);
        if (!unit) {
          return { error: "Vaga extra não está à venda neste condomínio.", statusCode: 400 };
        }

        const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com.br").replace(/\/$/, "");
        const label = kind === "service" ? "serviço" : "produto";
        const session = await PaymentGateway.createCheckout({
          amount_cents: unit * quantity,
          currency: "BRL",
          productName: `${quantity} vaga(s) de anúncio de ${label} — ${ctx.community.display_name}`,
          customerEmail: user.email || undefined,
          clientReferenceId: user.id_user,
          successUrl: `${frontend}/comunidades/${communityIdOf(params)}?vaga=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${frontend}/comunidades/${communityIdOf(params)}?vaga=cancel`,
          metadata: {
            type: "condo_listing_slot",
            user_id: user.id_user,
            id_condo: communityIdOf(params),
            kind,
            quantity: String(quantity),
          },
        });

        await CommunityListingStorage.createSlotPurchase(pool, {
          id_condo: communityIdOf(params),
          id_user: user.id_user,
          kind,
          quantity,
          // A vaga registra QUEM COBROU. Antes era 'stripe' fixo — e o CHECK
          // da mig 198 nem aceitava outro valor, o que tornava a mentira
          // obrigatória. As migs 237/250 abriram o CHECK para os provedores
          // seguintes — hoje 'mercadopago'.
          payment_provider: providerOf(session),
          amount_cents: unit * quantity,
          stripe_session_id: session.id,
        });

        return { checkout_url: session.url, session_id: session.id };
      }
    );
  }

  /* ----------------------------- vagas: Poléns --------------------------- */

  static async purchaseSlotWithPolens(user, params, body) {
    return runWithLogs(
      log,
      "purchaseSlotWithPolens",
      () => ({ id_user: user?.id_user, id_condo: communityIdOf(params), kind: body?.kind }),
      async () => {
        const ctx = await territorialContext(pool, user?.id_user, communityIdOf(params), {
          require: "resident",
        });
        if (ctx.error) return ctx;

        const kind = KINDS.includes(body?.kind) ? body.kind : null;
        if (!kind) return { error: "Tipo inválido (service|product).", statusCode: 400 };

        const quantity = Math.min(
          MAX_SLOTS_PER_PURCHASE,
          Math.max(1, Math.round(Number(body?.quantity) || 1))
        );

        const settings = await CommunityListingStorage.getEffectiveSettings(pool, communityIdOf(params));
        const unit = Number(settings.extra_slot_price_polens);
        if (!unit) {
          return { error: "Vaga extra não pode ser comprada com Poléns aqui.", statusCode: 400 };
        }
        const amount = unit * quantity;

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const polenSettings = await PolenStorage.getSettings(client);
          if (!polenSettings?.is_active) {
            await client.query("ROLLBACK");
            return { error: "Sistema de Poléns inativo" };
          }

          // Trava a carteira antes de criar a linha: duas compras simultâneas
          // do mesmo morador serializam aqui (mesmo padrão da Loja de Funções).
          const wallet = await PolenStorage.getOrCreateWallet(client, user.id_user);

          const purchase = await CommunityListingStorage.createSlotPurchase(client, {
            id_condo: communityIdOf(params),
            id_user: user.id_user,
            kind,
            quantity,
            payment_provider: "polens",
            amount_polens: amount,
            status: "paid",
          });

          const debit = await PolenStorage.debit(client, {
            user_id: user.id_user,
            wallet_id: wallet.id,
            amount,
            type: "spend_condo_listing_slot",
            source: "condo_listing_slot",
            source_id: `condo:${communityIdOf(params)}:${kind}:${purchase.id_slot}`,
            metadata: { id_condo: communityIdOf(params), kind, quantity },
          });
          if (!debit) {
            await client.query("ROLLBACK");
            return {
              error: `Você precisa de ${amount} Poléns para comprar esta vaga.`,
              code: "insufficient_balance",
            };
          }

          await client.query("COMMIT");
          return {
            message: "Vaga liberada.",
            purchase,
            wallet: debit.wallet,
          };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* noop */
          }
          log.error("purchaseSlotWithPolens.fail", { id_user: user?.id_user, error: err.message });
          return { error: "Não foi possível comprar a vaga." };
        } finally {
          client.release();
        }
      }
    );
  }

  /* ------------------------------- webhook ------------------------------- */

  // Idempotente por session id: re-entrega do webhook não credita duas vezes.
  static async confirmStripeSession(session) {
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;
    const row = await CommunityListingStorage.markSlotPaid(pool, session.id, paymentIntentId);
    if (!row) {
      const existing = await CommunityListingStorage.getSlotBySession(pool, session.id);
      if (existing?.status === "paid") return { already: true };
      return { error: "Compra de vaga não encontrada para esta sessão." };
    }
    log.info("slot.paid", {
      id_slot: row.id_slot,
      id_condo: row.id_condo,
      kind: row.kind,
      quantity: row.quantity,
    });
    return { slot: row };
  }

  static async expireBySession(session_id) {
    const row = await CommunityListingStorage.markSlotCanceled(pool, session_id);
    return !!row;
  }

  // Estorno total → a vaga sai do saldo (anúncios existentes ficam; tirar do
  // ar é decisão da administração). Contrato da cadeia de charge.refunded:
  // devolve { ignored: true } quando o charge não é desta feature.
  static async handleChargeRefunded(charge) {
    const paymentIntentId =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id || null;
    if (!paymentIntentId) return { ignored: true };

    const slot = await CommunityListingStorage.getSlotByPaymentIntent(pool, paymentIntentId);
    if (!slot) return { ignored: true };

    if (!isFullRefund(charge)) {
      log.warn("refund.partial_ignored", {
        id_slot: slot.id_slot,
        amount_refunded: charge.amount_refunded,
      });
      return { handled: false, partial: true };
    }
    if (slot.refunded_at) return { handled: true, duplicate: true };

    const row = await CommunityListingStorage.markSlotRefundedById(pool, slot.id_slot);
    if (row) {
      log.info("slot.refunded", { id_slot: row.id_slot, id_condo: row.id_condo });
    }
    return { handled: true };
  }
}

module.exports = CommunityListingService;
