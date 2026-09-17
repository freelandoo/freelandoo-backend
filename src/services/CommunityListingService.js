// src/services/CommunityListingService.js
// As VITRINES das comunidades territoriais (mig 198): quadro de SERVIÇOS e de
// PRODUTOS dos moradores, hoje com MENSALIDADE por anúncio (mig 252).
//
// ─── ELA JÁ EXISTIA, E SÓ SERVIA CONDOMÍNIO ─────────────────────────────────
//
// A mig 198 construiu exatamente a vitrine que o bairro precisava — tipo
// (serviço|produto), título, descrição, preço, contato e foto. O que faltava
// era ela ATENDER as duas modalidades
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
// ─── ⚠️ A VITRINE É MENSAL (mig 252) ────────────────────────────────────────
//
// Não existe mais cota grátis nem saldo de vagas: cada ANÚNCIO custa uma
// mensalidade e só aparece para os vizinhos enquanto estiver pago
// (`paid_until > NOW()`, lido no SELECT — ver o storage).
//
// ⚠️ O ANÚNCIO NASCE RASCUNHO E ENTRA NA VITRINE NA CONFIRMAÇÃO DO PAGAMENTO.
// Nascendo no ar, o primeiro mês seria de graça para quem publicasse e nunca
// pagasse — e "pago desde o primeiro anúncio" deixaria de ser verdade.
//
// ⚠️ SÃO DOIS REGIMES, E CONFUNDI-LOS QUEBRA O CANCELAMENTO:
//
//   CARTÃO  → assinatura de verdade (`recurring: true` = preapproval do
//             Mercado Pago). Renova sozinha, e cada fatura paga empurra o
//             `paid_until` em um mês. É o caminho natural do fluxo.
//   PIX     → compra UM MÊS. Pix recorrente clássico não existe no Mercado
//             Pago, então aqui não há assinatura nenhuma: `subscription_ref`
//             fica NULL e a renovação é um gesto da pessoa.
//   POLÉNS  → igual ao Pix (compra um mês), pela régua de 1 Polén = R$ 0,01.
//
// ⚠️ CANCELAR NÃO TIRA DO AR NA HORA, e isso é a regra: o mês já pago é de
// quem pagou. Cancelar solta a renovação automática; quem tira o anúncio da
// vitrine é a data vencendo. Por isso este fluxo NÃO entra na fila da mig 251
// (`tb_subscription_end`) — o `paid_until` já É o fim do ciclo, e agendar um
// segundo "cancelar no fim do ciclo" seria uma segunda verdade sobre a mesma
// data.
//
// Quem recebe é a PLATAFORMA (não o síndico): é aluguel de espaço da
// Freelandoo, como o ingresso de comunidade. O padrão de pagamento é o de
// sempre — `price_data` ad-hoc, confirmação idempotente por session id no
// webhook, expiração de sessão e reversão em charge.refunded.

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
        const mine = query?.mine === "1";
        const listings = await CommunityListingStorage.list(pool, communityIdOf(params), {
          kind,
          status: mine ? "all" : "active",
          id_user: mine ? user.id_user : null,
          // ⚠️ O VIZINHO SÓ VÊ O QUE ESTÁ PAGO. Só a lista do próprio dono
          // enxerga rascunho e vencido — é nela que ele acha o anúncio para
          // pagar de novo, e é o que impede a vitrine de anunciar de graça.
          paid: mine ? "all" : "live",
          limit: query?.limit,
          offset: query?.offset,
        });
        return { listings };
      }
    );
  }

  //
  // O preço do mês e quantos anúncios do morador estão no ar. É o que a tela
  // mostra antes do botão "Publicar".
  //
  // ⚠️ A ROTA CONTINUA SE CHAMANDO `/quota` de propósito: front em cache ainda
  // a chama, e trocar o endereço faria a tela antiga receber 404 no lugar do
  // preço. O payload é que mudou — `free`/`purchased` saíram, porque não
  // existem mais, e um cliente velho lendo `total` agora lê "quantos estão no
  // ar", que é verdade e não engana ninguém.
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
          const [live, draftOrExpired] = await Promise.all([
            CommunityListingStorage.countLive(pool, communityIdOf(params), user.id_user, kind),
            CommunityListingStorage.countActive(pool, communityIdOf(params), user.id_user, kind),
          ]);
          quota[kind] = {
            live,
            // Anúncios escritos que não estão no ar: rascunho nunca pago ou
            // mensalidade vencida. É o número que dá o "você tem N anúncios
            // parados" na tela do dono.
            unpaid: Math.max(0, draftOrExpired - live),
            free: freeQuotaFor(settings, kind),
          };
        }

        return {
          quota,
          // Não há teto: quem paga publica quantos quiser.
          monthly_cents: settings.listing_monthly_cents,
          monthly_polens: settings.listing_monthly_polens,
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

        const settings = await CommunityListingStorage.getEffectiveSettings(pool, communityIdOf(params));

        // ⚠️ NÃO HÁ MAIS GATE DE COTA AQUI, E A RECUSA MUDOU DE LUGAR: quem
        // decide se o anúncio aparece é o `paid_until`, na leitura. Criar é
        // livre — o que custa é EXIBIR. Barrar a criação de um rascunho antes
        // do pagamento obrigaria a pessoa a pagar por um anúncio que ela ainda
        // não escreveu.
        //
        // A cota grátis sobrevive como cortesia opcional (hoje vale 0): com um
        // valor > 0, os N primeiros anúncios do morador já nascem no ar.
        const free = freeQuotaFor(settings, kind);
        const courtesy =
          free > 0 &&
          (await CommunityListingStorage.countLive(pool, communityIdOf(params), user.id_user, kind)) < free;

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

        if (courtesy) {
          const live = await CommunityListingStorage.extendPaidUntil(pool, listing.id_listing, 1);
          listing.paid_until = live?.paid_until || null;
        }

        // O front lê `needs_payment` para mandar direto ao pagamento em vez de
        // mostrar um anúncio publicado que ninguém vai ver.
        return {
          listing,
          needs_payment: !courtesy,
          monthly_cents: settings.listing_monthly_cents,
          monthly_polens: settings.listing_monthly_polens,
        };
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

        // ⚠️ REATIVAR NÃO REVALIDA COTA NENHUMA (mig 252): não há teto, e quem
        // decide se o anúncio aparece é o `paid_until`. Reativado dentro do mês
        // pago, ele volta à vitrine na hora; com a mensalidade vencida, volta a
        // ser um rascunho do dono até ele pagar.
        //
        // ⚠️ E ARQUIVAR NÃO DEVOLVE TEMPO. `paid_until` é data absoluta e corre
        // sozinha: guardar o anúncio por uma semana não estica o mês. Era isso
        // que o saldo de vagas fazia — arquivar liberava a vaga —, e mantê-lo
        // aqui daria vitrine de graça a quem soubesse alternar os dois botões.

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

  /* --------------------------- mensalidade: dinheiro --------------------- */

  /**
   * Põe (ou mantém) UM anúncio no ar.
   *
   * `method='card'` cria uma ASSINATURA (preapproval) que renova sozinha;
   * `method='pix'` cobra UM MÊS, porque recorrência em Pix não existe no
   * Mercado Pago.
   *
   * ⚠️ O ANÚNCIO É CONFERIDO ANTES DA IDA À REDE, e o dono também. Sem isso,
   * qualquer morador da comunidade poderia abrir o checkout de um anúncio
   * alheio — e, pior, o pagamento dele acabaria estendendo a vigência do
   * anúncio de outra pessoa.
   */
  static async createListingCheckout(user, params, body) {
    return runWithLogs(
      log,
      "createListingCheckout",
      () => ({ id_user: user?.id_user, id_listing: params?.id_listing, method: body?.method }),
      async () => {
        const ctx = await territorialContext(pool, user?.id_user, communityIdOf(params), {
          require: "resident",
        });
        if (ctx.error) return ctx;

        const listing = await CommunityListingStorage.getById(
          pool,
          communityIdOf(params),
          params.id_listing
        );
        if (!listing) return { error: "Anúncio não encontrado", statusCode: 404 };
        if (String(listing.id_user) !== String(user.id_user)) {
          return { error: "Este anúncio não é seu.", statusCode: 403 };
        }

        const method = body?.method === "pix" ? "pix" : "card";

        // ⚠️ DUAS ASSINATURAS NO MESMO ANÚNCIO COBRARIAM DUAS VEZES POR MÊS, e
        // a segunda ficaria invisível: `subscription_ref` guarda uma só, então
        // a primeira sumiria da nossa vista continuando viva no gateway — uma
        // cobrança que ninguém aqui sabe cancelar.
        if (method === "card" && listing.subscription_ref && listing.subscription_status === "active") {
          return {
            error: "Este anúncio já tem uma assinatura ativa.",
            statusCode: 409,
            id_listing: listing.id_listing,
            paid_until: listing.paid_until,
          };
        }

        const settings = await CommunityListingStorage.getEffectiveSettings(pool, communityIdOf(params));
        const unit = Number(settings.listing_monthly_cents);
        if (!unit) {
          return { error: "A vitrine não está cobrando mensalidade aqui.", statusCode: 400 };
        }

        const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com.br").replace(/\/$/, "");
        const label = listing.kind === "service" ? "serviço" : "produto";
        const backTo = `${frontend}/comunidades/${communityIdOf(params)}?aba=${listing.kind}s`;

        const session = await PaymentGateway.createCheckout({
          amount_cents: unit,
          currency: "BRL",
          recurring: method === "card",
          productName: `Anúncio de ${label} — ${listing.title}`,
          description: `Vitrine de ${ctx.community.display_name}`,
          // ⚠️ Obrigatório no preapproval do Mercado Pago: sem e-mail do
          // pagador a assinatura sequer é criada.
          customerEmail: user.email || undefined,
          clientReferenceId: user.id_user,
          successUrl: `${backTo}&anuncio=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${backTo}&anuncio=cancel`,
          metadata: {
            type: "condo_listing_slot",
            user_id: user.id_user,
            id_condo: communityIdOf(params),
            id_listing: String(listing.id_listing),
            kind: listing.kind,
            method,
          },
        });

        await CommunityListingStorage.createSlotPurchase(pool, {
          id_condo: communityIdOf(params),
          id_user: user.id_user,
          kind: listing.kind,
          id_listing: listing.id_listing,
          quantity: 1,
          payment_provider: providerOf(session),
          amount_cents: unit,
          stripe_session_id: session.id,
        });

        // ⚠️ A ASSINATURA É GRAVADA AQUI, NA CRIAÇÃO, e não só na confirmação:
        // a renovação chega como fatura e é por `subscription_ref` que ela acha
        // o anúncio. Gravando só no fulfill, uma primeira fatura que chegasse
        // antes dele não teria como ser roteada — e o mês pago sumiria.
        //
        // Nasce 'past_due' porque autorizado ainda não é pago: o preapproval do
        // Mercado Pago nasce `pending` até a pessoa concluir. Quem promove para
        // 'active' é o pagamento confirmado.
        if (method === "card" && session.subscription) {
          await CommunityListingStorage.attachSubscription(pool, listing.id_listing, {
            ref: session.subscription,
            provider: providerOf(session),
            status: "past_due",
          });
        }

        return { checkout_url: session.url, session_id: session.id, method };
      }
    );
  }

  /* ---------------------------- mensalidade: Poléns ---------------------- */

  static async payListingWithPolens(user, params, body) {
    return runWithLogs(
      log,
      "payListingWithPolens",
      () => ({ id_user: user?.id_user, id_listing: params?.id_listing }),
      async () => {
        const ctx = await territorialContext(pool, user?.id_user, communityIdOf(params), {
          require: "resident",
        });
        if (ctx.error) return ctx;

        const listing = await CommunityListingStorage.getById(
          pool,
          communityIdOf(params),
          params.id_listing
        );
        if (!listing) return { error: "Anúncio não encontrado", statusCode: 404 };
        if (String(listing.id_user) !== String(user.id_user)) {
          return { error: "Este anúncio não é seu.", statusCode: 403 };
        }

        const months = Math.min(12, Math.max(1, Math.round(Number(body?.months) || 1)));

        const settings = await CommunityListingStorage.getEffectiveSettings(pool, communityIdOf(params));
        const unit = Number(settings.listing_monthly_polens);
        if (!unit) {
          return { error: "Esta vitrine não aceita Poléns.", statusCode: 400 };
        }
        const amount = unit * months;

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const polenSettings = await PolenStorage.getSettings(client);
          if (!polenSettings?.is_active) {
            await client.query("ROLLBACK");
            return { error: "Sistema de Poléns inativo" };
          }

          // Trava a carteira antes de criar a linha: dois pagamentos simultâneos
          // do mesmo morador serializam aqui (padrão da Loja de Funções).
          const wallet = await PolenStorage.getOrCreateWallet(client, user.id_user);

          const purchase = await CommunityListingStorage.createSlotPurchase(client, {
            id_condo: communityIdOf(params),
            id_user: user.id_user,
            kind: listing.kind,
            id_listing: listing.id_listing,
            quantity: months,
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
            source_id: `condo:${communityIdOf(params)}:${listing.kind}:${purchase.id_slot}`,
            metadata: {
              id_condo: communityIdOf(params),
              id_listing: listing.id_listing,
              kind: listing.kind,
              months,
            },
          });
          if (!debit) {
            await client.query("ROLLBACK");
            return {
              error: `Você precisa de ${amount} Poléns para deixar este anúncio no ar.`,
              code: "insufficient_balance",
            };
          }

          // ⚠️ A VIGÊNCIA É EMPURRADA DENTRO DA MESMA TRANSAÇÃO DO DÉBITO. Fora
          // dela, uma falha no meio cobraria os Poléns e deixaria o anúncio
          // parado — dinheiro tirado sem entrega.
          const before = listing.paid_until;
          const live = await CommunityListingStorage.extendPaidUntil(
            client,
            listing.id_listing,
            months
          );
          await CommunityListingStorage.setSlotPeriod(client, purchase.id_slot, {
            period_start: before && new Date(before) > new Date() ? before : new Date(),
            period_end: live?.paid_until || null,
          });

          await client.query("COMMIT");
          return {
            message: "Anúncio no ar.",
            paid_until: live?.paid_until || null,
            purchase,
            wallet: debit.wallet,
          };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* noop */
          }
          log.error("payListingWithPolens.fail", { id_user: user?.id_user, error: err.message });
          return { error: "Não foi possível pagar o anúncio." };
        } finally {
          client.release();
        }
      }
    );
  }

  /* ------------------------------ cancelamento --------------------------- */

  /**
   * Solta a renovação automática do anúncio.
   *
   * ⚠️ NÃO TIRA O ANÚNCIO DO AR: o mês já pago é de quem pagou, e o
   * `paid_until` continua valendo até vencer. Tirar na hora seria cobrar o mês
   * e entregar meio — e é justamente o defeito que a mig 251 existe para
   * fechar nos outros quatro fluxos.
   *
   * ⚠️ E A PORTA DE SAÍDA NÃO PODE DEPENDER DO GATEWAY RESPONDER. Se o cancel
   * remoto falhar, o vínculo local é solto mesmo assim e o erro fica no log:
   * deixar a pessoa presa a uma cobrança recorrente porque a API de terceiro
   * está fora é o pior estrago possível aqui.
   */
  static async cancelListingSubscription(user, params) {
    return runWithLogs(
      log,
      "cancelListingSubscription",
      () => ({ id_user: user?.id_user, id_listing: params?.id_listing }),
      async () => {
        const ctx = await territorialContext(pool, user?.id_user, communityIdOf(params), {
          require: "resident",
        });
        if (ctx.error) return ctx;

        const listing = await CommunityListingStorage.getById(
          pool,
          communityIdOf(params),
          params.id_listing
        );
        if (!listing) return { error: "Anúncio não encontrado", statusCode: 404 };
        if (String(listing.id_user) !== String(user.id_user)) {
          return { error: "Este anúncio não é seu.", statusCode: 403 };
        }
        if (!listing.subscription_ref) {
          return {
            error: "Este anúncio não tem assinatura — ele fica no ar até a data paga.",
            statusCode: 409,
            paid_until: listing.paid_until,
          };
        }

        try {
          await PaymentGateway.cancelSubscription(listing.subscription_ref, { immediate: true });
        } catch (err) {
          log.warn("cancel.remote_fail", {
            id_listing: listing.id_listing,
            subscription_ref: listing.subscription_ref,
            error: err.message,
          });
        }

        const row = await CommunityListingStorage.detachSubscription(pool, listing.id_listing);
        return {
          message: "Renovação cancelada. O anúncio fica no ar até o fim do período pago.",
          paid_until: row?.paid_until || listing.paid_until,
        };
      }
    );
  }

  /* ------------------------------- webhook ------------------------------- */

  //
  // Primeiro mês (cartão ou Pix): confirma a cobrança e põe o anúncio no ar.
  // Idempotente por session id — re-entrega do webhook não credita duas vezes.
  static async confirmStripeSession(session) {
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;
    const row = await CommunityListingStorage.markSlotPaid(pool, session.id, paymentIntentId);
    if (!row) {
      const existing = await CommunityListingStorage.getSlotBySession(pool, session.id);
      if (existing?.status === "paid") return { already: true };
      return { error: "Cobrança de anúncio não encontrada para esta sessão." };
    }

    // ⚠️ COBRANÇA ANTIGA (mig 198) NÃO TEM ANÚNCIO, e não pode derrubar o
    // webhook: ela era saldo de vaga, não mensalidade. Confirma e segue.
    if (!row.id_listing) {
      log.info("slot.paid.legacy", { id_slot: row.id_slot, id_condo: row.id_condo });
      return { slot: row };
    }

    const before = await CommunityListingStorage.getByIdRaw(pool, row.id_listing);
    const live = await CommunityListingStorage.extendPaidUntil(pool, row.id_listing, row.quantity || 1);
    await CommunityListingStorage.setSlotPeriod(pool, row.id_slot, {
      period_start:
        before?.paid_until && new Date(before.paid_until) > new Date()
          ? before.paid_until
          : new Date(),
      period_end: live?.paid_until || null,
    });

    // Autorizou e pagou: a assinatura vira ativa de fato.
    if (before?.subscription_ref) {
      await CommunityListingStorage.setSubscriptionStatus(pool, row.id_listing, "active");
    }

    log.info("listing.paid", {
      id_slot: row.id_slot,
      id_listing: row.id_listing,
      id_condo: row.id_condo,
      paid_until: live?.paid_until,
    });
    return { slot: row, listing: live };
  }

  static async expireBySession(session_id) {
    const row = await CommunityListingStorage.markSlotCanceled(pool, session_id);
    return !!row;
  }

  /* --------------------- webhook: ciclo da assinatura -------------------- */

  //
  // ⚠️ CONTRATO DA CADEIA: devolver `{ ignored: true }` quando a assinatura não
  // for desta feature. O webhook tenta um fluxo depois do outro, e responder
  // qualquer outra coisa faria este parar a fila dos que vêm depois.
  static async handleInvoicePaid(invoice, subscriptionId) {
    if (!subscriptionId) return { ignored: true };
    const listing = await CommunityListingStorage.getBySubscriptionRef(pool, subscriptionId);
    if (!listing) return { ignored: true };

    // ⚠️ SEM ID DE FATURA NÃO DÁ PARA DEDUPLICAR, e o webhook é at-least-once:
    // creditar assim mesmo empurraria o `paid_until` mais um mês a cada
    // re-entrega. Sem o id, não credita — o lado seguro do erro é a pessoa
    // reclamar que o anúncio venceu, não a plataforma dar meses de graça.
    const invoiceRef = invoice?.id || null;
    if (!invoiceRef) {
      log.warn("renewal.no_invoice_id", { id_listing: listing.id_listing, subscriptionId });
      return { handled: false, reason: "invoice_sem_id" };
    }

    const recorded = await CommunityListingStorage.recordRenewalOnce(pool, {
      id_condo: listing.id_condo,
      id_user: listing.id_user,
      kind: listing.kind,
      id_listing: listing.id_listing,
      payment_provider: listing.subscription_provider || providerOf(invoice),
      amount_cents: Number(invoice?.amount_paid ?? invoice?.amount_due ?? 0) || 0,
      invoice_ref: invoiceRef,
    });
    if (!recorded) return { handled: true, duplicate: true };

    const live = await CommunityListingStorage.extendPaidUntil(pool, listing.id_listing, 1);
    await CommunityListingStorage.setSlotPeriod(pool, recorded.id_slot, {
      period_start:
        listing.paid_until && new Date(listing.paid_until) > new Date()
          ? listing.paid_until
          : new Date(),
      period_end: live?.paid_until || null,
    });
    await CommunityListingStorage.setSubscriptionStatus(pool, listing.id_listing, "active");

    log.info("listing.renewed", {
      id_listing: listing.id_listing,
      paid_until: live?.paid_until,
    });
    return { handled: true, listing: live };
  }

  //
  // Cobrança falhou: o anúncio NÃO sai do ar agora — ele sai quando o mês que
  // já foi pago acabar. Marcar é o que permite avisar o dono antes disso.
  static async handleInvoiceFailed(subscriptionId) {
    if (!subscriptionId) return { ignored: true };
    const listing = await CommunityListingStorage.getBySubscriptionRef(pool, subscriptionId);
    if (!listing) return { ignored: true };

    await CommunityListingStorage.setSubscriptionStatus(pool, listing.id_listing, "past_due");
    log.info("listing.past_due", { id_listing: listing.id_listing });
    return { handled: true };
  }

  //
  // Assinatura encerrada (pelo dono, pelo gateway ou por falha repetida): solta
  // o vínculo e deixa a vigência correr até vencer.
  static async handleSubscriptionDeleted(subscription) {
    const ref = typeof subscription === "string" ? subscription : subscription?.id;
    if (!ref) return { ignored: true };
    const listing = await CommunityListingStorage.getBySubscriptionRef(pool, ref);
    if (!listing) return { ignored: true };

    await CommunityListingStorage.detachSubscription(pool, listing.id_listing);
    log.info("listing.subscription_ended", {
      id_listing: listing.id_listing,
      paid_until: listing.paid_until,
    });
    return { handled: true };
  }

  //
  // Estorno total → o mês que aquela cobrança comprou é DEVOLVIDO: a vigência
  // recua o mesmo tanto que ela empurrou. Caindo no passado, o anúncio sai da
  // vitrine sozinho na leitura seguinte.
  //
  // ⚠️ O ANÚNCIO NÃO É APAGADO. Dinheiro devolvido tira o espaço, não o texto
  // que a pessoa escreveu — ela volta a exibi-lo pagando de novo.
  //
  // Contrato da cadeia de charge.refunded: `{ ignored: true }` quando o charge
  // não é desta feature.
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
    if (slot.id_listing) {
      await CommunityListingStorage.shrinkPaidUntil(pool, slot.id_listing, slot.quantity || 1);
    }
    if (row) {
      log.info("listing.refunded", {
        id_slot: row.id_slot,
        id_condo: row.id_condo,
        id_listing: slot.id_listing,
      });
    }
    return { handled: true };
  }
}

module.exports = CommunityListingService;
