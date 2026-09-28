// src/services/CommunityDeliveryService.js
//
// DELIVERY ENTRE VIZINHOS (mig 248) — condomínio e bairro.
//
// Pedido do Alex: "qualquer pessoa da comunidade pode chamar um delivery mesmo
// sem ter comprado — por exemplo, buscar na portaria algo que chegou de iFood"
// e "qualquer um da comunidade pode pegar o chamado e receber".
//
// ─── AS CINCO DECISÕES DELE QUE NÃO PODEM REGREDIR ──────────────────────────
//
// 1. COBRANÇA POR CORRIDA, com tabela de preços (comida R$3 · encomenda R$4 ·
//    mudança R$50 · volumoso R$50). Ele recusou carteira pré-paga e Poléns.
// 2. QUEM ENTREGA ABSORVE A TARIFA do gateway. Ele sabe que numa corrida de
//    R$3 no Asaas/Pix sobram R$1,01 e manteve a decisão depois de a conta ser
//    levantada duas vezes. NÃO reabrir.
// 3. DELIVERY É ABERTO A QUALQUER MEMBRO — não existe papel promovido. Ele
//    disse "como professor" na primeira descrição e CORRIGIU em seguida:
//    "qualquer um da comunidade pode ir receber". Vale a correção.
// 4. COBRA-SE NO ACEITE. Chamado que ninguém pega expira sem custo nenhum.
// 5. QUEM PEDIU CONFIRMA, COM PRAZO; sem resposta no prazo, libera sozinho.
//
// ─── O QUE A ORDEM DAS ESCRITAS PROTEGE ─────────────────────────────────────
//
// No ACEITE:  trava o chamado no banco  →  só então cria a cobrança.
//   Invertido, duas pessoas apertando "Aceitar" ao mesmo tempo seriam as duas
//   cobradas, e uma delas descobriria que a corrida não era dela DEPOIS de
//   pagar.
//
// Na CONCLUSÃO:  apura a tarifa real  →  só então escreve o repasse.
//   Invertido, a corrida ficaria certa e o repasse errado — e é o repasse que
//   vira saque. É a mesma ordem do `BookingService.confirmBookingFromWebhook`,
//   copiada de lá de propósito.

const pool = require("../databases");
const CommunityDeliveryStorage = require("../storages/CommunityDeliveryStorage");
const StoreGovernanceService = require("./StoreGovernanceService");
const NotificationService = require("./NotificationService");
const PaymentGateway = require("../integrations/payments");
const { providerOf } = require("../integrations/payments/contract");
const { isFullRefund } = require("../utils/refunds");
const { territorialContext } = require("../utils/territorialCommunity");
const {
  isDeliveryKind,
  listDeliveryTypes,
  getDeliveryType,
  estimateProcessorFee,
  courierNet,
  courierNetPreview,
  STRIKE_LIMIT,
  STRIKE_WINDOW_DAYS,
  STRIKE_BLOCK_HOURS,
  isWeightBand,
  isDeliveryDirection,
  kindForBand,
  listWeightBands,
  getWeightBand,
} = require("../utils/deliveryPricing");
const { createLogger, runWithLogs } = require("../utils/logger");
const realtime = require("../realtime/socket");

const log = createLogger("CommunityDeliveryService");

const MAX_NOTE = 500;
const MAX_PLACE = 160;
const FLAG = "delivery_vizinho";

function clean(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function communityIdOf(params) {
  return params?.id_profile || params?.id_community || null;
}

/**
 * Empurra a mudança para quem está com a tela aberta.
 *
 * ⚠️ O EVENTO PRECISA ESTAR NA LISTA `events` DE `lib/realtime.ts` no front.
 * Evento fora dela simplesmente não chega — o socket não o repassa — e a tela
 * pareceria congelada, com o chamado aceito por alguém e o quadro mostrando
 * "aberto" até um F5.
 *
 * Best-effort: falha de socket nunca derruba a operação que já aconteceu no
 * banco.
 */
function push(userIds, payload) {
  try {
    for (const id of new Set((userIds || []).filter(Boolean).map(String))) {
      realtime.emitToUser(id, "delivery:changed", payload);
    }
  } catch {
    /* realtime é best-effort */
  }
}

/**
 * O MODAL DE TODOS OS MEMBROS (mig 266): "fulano quer enviar / receber uma
 * encomenda — você pode levar / buscar?". Vai por socket para quem está com a
 * Freelandoo aberta; o sino continua só para quem ligou "disponível agora",
 * senão um bairro inteiro receberia uma notificação por corrida.
 *
 * ⚠️ `delivery:broadcast` PRECISA ESTAR NA LISTA `events` DE `lib/realtime.ts`.
 */
function broadcast(userIds, payload) {
  try {
    for (const id of new Set((userIds || []).filter(Boolean).map(String))) {
      realtime.emitToUser(id, "delivery:broadcast", payload);
    }
  } catch {
    /* realtime é best-effort */
  }
}

/** Mensagem de erro em reais. O backend fala pt (a tela traduz os estados). */
function brl(cents) {
  return `R$ ${(Number(cents || 0) / 100).toFixed(2).replace(".", ",")}`;
}

const MAX_PROPOSAL_NOTE = 280;
/** Teto de oferta/proposta: conferência de digitação (R$ 1.000), como no admin. */
const MAX_OFFER_CENTS = 100000;

class CommunityDeliveryService {
  /**
   * O contexto do delivery = o contexto territorial + a flag desta feature.
   *
   * ⚠️ A FLAG NÃO BARRA CONCLUIR NEM CANCELAR. Desligar o kill-switch tem que
   * segurar o que ainda não nasceu (abrir chamado novo, aceitar), nunca prender
   * dinheiro de uma corrida que já está em pé — o vizinho carregou o sofá e não
   * pode ficar sem receber porque o admin apertou um interruptor. Mesma regra
   * de `GET /me/spaces` e do site publicado.
   */
  static async _ctx(id_user, params, { require: level = "resident", checkFlag = true } = {}) {
    const ctx = await territorialContext(pool, id_user, communityIdOf(params), { require: level });
    if (ctx.error) return ctx;
    if (checkFlag) {
      const FeatureFlagService = require("./FeatureFlagService");
      let enabled = true;
      try {
        enabled = await FeatureFlagService.isEnabled(FLAG);
      } catch {
        enabled = true; // fail-open, como o requireFeature
      }
      if (!enabled) {
        return { error: "Recurso indisponível no momento.", statusCode: 403, feature_disabled: FLAG };
      }
    }
    return ctx;
  }

  /* -------------------------------- leitura ------------------------------- */

  /**
   * O quadro: tipos disponíveis (com o LÍQUIDO de quem entrega), chamados e a
   * situação de quem está olhando.
   */
  static async board(user, params, query) {
    return runWithLogs(
      log,
      "board",
      () => ({ id_user: user?.id_user, id_community: communityIdOf(params) }),
      async () => {
        const ctx = await this._ctx(user?.id_user, params, { require: "resident" });
        if (ctx.error) return ctx;

        const [types, governance, bands] = await Promise.all([
          listDeliveryTypes(pool),
          StoreGovernanceService.getSettings(),
          listWeightBands(pool),
        ]);

        const status = query?.status || "open";
        const [items, available, block] = await Promise.all([
          CommunityDeliveryStorage.list(pool, ctx.community.id_profile, {
            status,
            mine: query?.mine === "1" ? user.id_user : null,
            limit: query?.limit,
            offset: query?.offset,
          }),
          CommunityDeliveryStorage.getAvailability(pool, ctx.community.id_profile, user.id_user),
          this._strikeBlock(user.id_user),
        ]);

        // As contrapropostas (mig 266). Quem PEDIU vê todas as do seu chamado;
        // o vizinho vê só a DELE — as outras propostas são assunto de quem
        // escolhe, e mostrar o lance alheio viraria leilão entre vizinhos.
        const openIds = items.filter((d) => d.status === "open" && d.negotiable).map((d) => d.id_delivery);
        const proposals = await CommunityDeliveryStorage.listPendingProposals(pool, openIds);
        const byDelivery = new Map();
        for (const pr of proposals) {
          const k = String(pr.id_delivery);
          if (!byDelivery.has(k)) byDelivery.set(k, []);
          byDelivery.get(k).push(pr);
        }

        return {
          // As faixas de peso com o LÍQUIDO do piso, pela mesma regra dos tipos.
          bands: bands.map((b) => ({
            ...b,
            ...courierNetPreview(b.min_cents, governance),
          })),
          // ⚠️ CADA TIPO SAI COM O LÍQUIDO JUNTO. A tela de quem entrega mostra
          // "você recebe R$X,XX", nunca o bruto: se o card anuncia R$3 e caem
          // R$1,01, o vizinho descobre na primeira corrida e não faz a segunda.
          types: types.map((t) => ({
            ...t,
            ...courierNetPreview(t.price_cents, governance),
          })),
          // ⚠️ O LINK DE PAGAMENTO SAI SÓ PARA QUEM PAGA. Ele é uma sessão de
          // checkout no nome de quem PEDIU; entregue a qualquer um que abre o
          // quadro, um vizinho curioso poderia pagar a corrida de outra pessoa
          // (ou, pior, ver o link sumir do próprio card por já estar pago).
          deliveries: items.map((d) => {
            const isRequester = String(d.id_requester) === String(user.id_user);
            const list = byDelivery.get(String(d.id_delivery)) || [];
            return {
              ...d,
              checkout_url: isRequester ? d.checkout_url : undefined,
              // O líquido de quem entrega pelo valor ATUAL (a oferta pode ter
              // subido desde a abertura).
              courier_preview: courierNetPreview(d.price_cents, governance),
              proposals: isRequester ? list : undefined,
              my_proposal: isRequester
                ? undefined
                : list.find((pr) => String(pr.id_courier) === String(user.id_user)) || null,
            };
          }),
          viewer: {
            id_user: user.id_user,
            is_available: available,
            // O freio do cancelamento, dito em voz alta: bloqueio silencioso
            // parece defeito.
            accept_blocked_until: block.blockedUntil,
            recent_cancels: block.count,
          },
        };
      }
    );
  }

  /* ------------------------------- abertura ------------------------------- */

  static async open(user, params, body) {
    return runWithLogs(
      log,
      "open",
      () => ({ id_user: user?.id_user, id_community: communityIdOf(params), kind: body?.kind }),
      async () => {
        const ctx = await this._ctx(user?.id_user, params, { require: "resident" });
        if (ctx.error) return ctx;

        // ── o chamado por PESO (mig 266) ──────────────────────────────────────
        if (body?.weight_band !== undefined || body?.direction !== undefined) {
          return this._openByWeight(ctx, user, body);
        }

        if (!isDeliveryKind(body?.kind)) {
          return { error: "Tipo de chamado inválido.", statusCode: 400 };
        }
        const type = await getDeliveryType(pool, body.kind);
        if (!type) {
          return { error: "Este tipo de chamado não está disponível agora.", statusCode: 400 };
        }

        // ⚠️ O PREÇO É CONGELADO AQUI (snapshot na linha). Mexer na tabela de
        // admin depois não pode mudar o valor de um chamado que já está no ar:
        // quem aceita leu um número, e é esse que vale.
        const expires_at = new Date(Date.now() + Number(type.expires_minutes) * 60 * 1000);

        const row = await CommunityDeliveryStorage.create(pool, {
          id_community: ctx.community.id_profile,
          id_requester: user.id_user,
          kind: type.kind,
          price_cents: Number(type.price_cents),
          note: clean(body?.note, MAX_NOTE),
          pickup: clean(body?.pickup, MAX_PLACE),
          dropoff: clean(body?.dropoff, MAX_PLACE),
          expires_at,
        });

        // Quem ligou "disponível agora" é avisado. Fire-and-forget: falha de
        // aviso não pode derrubar um chamado que já existe.
        this._notifyOpened(ctx.community, row).catch(() => {});

        return { delivery: row };
      }
    );
  }

  /* -------------------------------- aceite -------------------------------- */

  /**
   * ⚠️ AQUI ESTÁ A DECISÃO 4 DO ALEX: a cobrança nasce NO ACEITE, não na
   * abertura. Chamado que ninguém pega expira sem custo nenhum — é o que
   * permite abrir um pedido às 23h sem medo de pagar por um favor que não
   * aconteceu.
   *
   * ⚠️ E A ORDEM É TRAVAR → COBRAR. O UPDATE condicionado (`status='open' AND
   * id_courier IS NULL`) serializa dois vizinhos apertando ao mesmo tempo: um
   * ganha a linha, o outro recebe zero linhas e lê "alguém já pegou". Cobrando
   * antes de travar, os DOIS seriam cobrados pela mesma corrida.
   */
  static async accept(user, params) {
    return runWithLogs(
      log,
      "accept",
      () => ({ id_user: user?.id_user, id_delivery: params?.id_delivery }),
      async () => {
        const ctx = await this._ctx(user?.id_user, params, { require: "resident" });
        if (ctx.error) return ctx;

        const delivery = await CommunityDeliveryStorage.getById(pool, params.id_delivery);
        if (!delivery || String(delivery.id_community) !== String(ctx.community.id_profile)) {
          return { error: "Chamado não encontrado.", statusCode: 404 };
        }
        if (String(delivery.id_requester) === String(user.id_user)) {
          return { error: "Você não pode aceitar o seu próprio chamado.", statusCode: 400 };
        }

        // O freio dos cancelamentos em série.
        const block = await this._strikeBlock(user.id_user);
        if (block.blockedUntil) {
          return {
            error:
              "Você cancelou corridas demais nos últimos dias. Espere um pouco para aceitar outra.",
            statusCode: 429,
            blocked_until: block.blockedUntil,
          };
        }

        return this._lockAndCharge(ctx, delivery, user, {});
      }
    );
  }

  /**
   * TRAVA → COBRA, em um lugar só. É o corpo do aceite direto e do aceite de
   * uma contraproposta (mig 266): escrito duas vezes, uma das portas esqueceria
   * o caso do chamado já pago ou a devolução para `open` quando a cobrança
   * falha, e o vizinho pagaria duas vezes ou ficaria preso num aceite sem
   * pagamento.
   *
   * `user` é QUEM ENTREGA (quem aceitou ou quem fez a proposta escolhida).
   */
  static async _lockAndCharge(ctx, delivery, user, { price_cents = null, id_proposal = null } = {}) {
    const locked = await CommunityDeliveryStorage.accept(pool, delivery.id_delivery, user.id_user, {
      accepted_at: new Date(),
      price_cents: price_cents ?? null,
    });
    if (!locked) {
      return { error: "Alguém já pegou este chamado.", statusCode: 409 };
    }

    // Chamado aceito não tem mais o que negociar: a proposta escolhida
    // vira `accepted` e as outras `declined`, NUM passo só — dois passos
    // soltos correriam um contra o outro e podiam recusar a escolhida.
    try {
      if (id_proposal) {
        await CommunityDeliveryStorage.settleProposals(pool, locked.id_delivery, id_proposal);
      } else {
        await CommunityDeliveryStorage.declinePendingProposals(pool, locked.id_delivery);
      }
    } catch (err) {
      log.warn("accept.settle_proposals.fail", { id_delivery: locked.id_delivery, message: err?.message });
    }

    // ⚠️ CHAMADO JÁ PAGO NÃO COBRA DE NOVO (mig 249). Quando a entrega veio
    // como add-on de uma compra na vitrine ("+R$3"), o dinheiro entrou
    // JUNTO com o do produto, numa cobrança só — e a linha já nasce
    // `payment_status = 'paid'` com `id_listing_order` preenchido. Sem esta
    // saída antecipada, o aceite criaria uma segunda cobrança e o vizinho
    // pagaria a entrega DUAS VEZES.
    //
    // O `courier_cents` já veio calculado do pedido (com a tarifa do
    // gateway rateada entre produto e entrega), então quem aceita recebe
    // exatamente o que a tela prometeu.
    if (locked.payment_status === "paid") {
      this._notifyAccepted(ctx.community, locked, user).catch(() => {});
      push([locked.id_requester, locked.id_courier], {
        id_delivery: locked.id_delivery,
        status: locked.status,
      });
      return { delivery: locked, prepaid: true };
    }

    // ── a cobrança ────────────────────────────────────────────────────────
    // Daqui para baixo o chamado JÁ ESTÁ TRAVADO no nome de quem aceitou.
    // Se a criação da cobrança falhar, ele é devolvido para `open` — senão
    // ficaria preso em `accepted` sem pagamento, invisível para todo mundo.
    try {
      const governance = await StoreGovernanceService.getSettings();
      const estimate = estimateProcessorFee(locked.price_cents, governance);
      const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com.br").replace(
        /\/$/,
        ""
      );
      const back = `${frontend}/comunidades/${ctx.community.id_profile}/delivery`;

      const session = await PaymentGateway.createCheckout({
        amount_cents: Number(locked.price_cents),
        currency: "BRL",
        productName: `Entrega — ${ctx.community.display_name}`,
        // ⚠️ QUEM PAGA É QUEM PEDIU, não quem aceitou. `clientReferenceId`
        // e o e-mail têm que ser os dele: trocar os dois lados cobraria do
        // entregador a corrida que ele foi fazer.
        clientReferenceId: locked.id_requester,
        successUrl: `${back}?entrega=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${back}?entrega=cancel`,
        metadata: {
          type: "community_delivery",
          user_id: locked.id_requester,
          id_community: ctx.community.id_profile,
          id_delivery: String(locked.id_delivery),
        },
      });

      const charged = await CommunityDeliveryStorage.attachCharge(pool, locked.id_delivery, {
        provider: providerOf(session),
        session_id: session.id,
        provider_ref: session.provider_ref || session.id,
        checkout_url: session.url || null,
        processor_fee_cents: estimate.cents,
        processor_fee_source: estimate.source,
        courier_cents: courierNet({
          chargeAmountCents: locked.price_cents,
          processorFeeCents: estimate.cents,
        }),
      });

      this._notifyAccepted(ctx.community, charged, user).catch(() => {});
      push([charged.id_requester, charged.id_courier], {
        id_delivery: charged.id_delivery,
        status: charged.status,
      });

      return { delivery: charged, checkout_url: session.url, session_id: session.id };
    } catch (err) {
      log.error("accept.charge.fail", {
        id_delivery: locked.id_delivery,
        message: err?.message,
      });
      await CommunityDeliveryStorage.releaseByCourier(pool, locked.id_delivery, user.id_user, {
        expires_at: locked.expires_at,
      });
      return { error: "Não foi possível iniciar a cobrança. Tente de novo.", statusCode: 502 };
    }
  }

  /* ------------------------ delivery por peso (266) ------------------------ */

  /**
   * Abre um chamado por PESO: quem pede diz se ENVIA ou RECEBE, a faixa de
   * peso e quanto oferece — nunca menos que o piso da faixa.
   *
   * ⚠️ O PISO É DO BACKEND E É CONGELADO NA LINHA. A tela mostra o mínimo, mas
   * quem decide é aqui: um cliente que mandasse R$0,50 por uma mudança
   * passaria pela tela e pararia nesta linha.
   */
  static async _openByWeight(ctx, user, body) {
    if (!isDeliveryDirection(body?.direction)) {
      return { error: "Diga se você quer enviar ou receber.", statusCode: 400 };
    }
    if (!isWeightBand(body?.weight_band)) {
      return { error: "Escolha a faixa de peso.", statusCode: 400 };
    }
    const band = await getWeightBand(pool, body.weight_band);
    if (!band) {
      return { error: "Esta faixa de peso não está disponível agora.", statusCode: 400 };
    }

    const min = Number(band.min_cents) || 0;
    const offered =
      body?.price_cents === undefined || body?.price_cents === null
        ? min
        : Math.round(Number(body.price_cents));
    if (!Number.isFinite(offered) || offered < min) {
      return {
        error: `O mínimo para esta faixa é ${brl(min)}.`,
        statusCode: 400,
        min_price_cents: min,
      };
    }
    if (offered > MAX_OFFER_CENTS) {
      return { error: "Valor alto demais para uma corrida.", statusCode: 400 };
    }

    // O `kind` da mig 248 continua mandando nos PRAZOS (expiração e
    // confirmação): carga negociada herda os de `bulky`.
    const kind = kindForBand(band.band);
    const type = await getDeliveryType(pool, kind, { onlyActive: false });
    const expiresMinutes = Number(type?.expires_minutes) || 1440;

    const row = await CommunityDeliveryStorage.create(pool, {
      id_community: ctx.community.id_profile,
      id_requester: user.id_user,
      kind,
      price_cents: offered,
      note: clean(body?.note, MAX_NOTE),
      pickup: clean(body?.pickup, MAX_PLACE),
      dropoff: clean(body?.dropoff, MAX_PLACE),
      expires_at: new Date(Date.now() + expiresMinutes * 60 * 1000),
      direction: body.direction,
      weight_band: band.band,
      min_price_cents: min,
      negotiable: band.negotiable === true,
    });

    this._notifyOpened(ctx.community, row).catch(() => {});
    this._broadcastOpened(ctx.community, row, band, "opened").catch(() => {});

    return { delivery: row };
  }

  /**
   * "Caso ninguém aceite, quem pediu pode oferecer mais." Só sobe, só em
   * chamado aberto e sem ninguém. O modal volta a aparecer para os membros —
   * uma oferta nova é, na prática, um chamado novo para quem recusou o antigo.
   */
  static async raiseOffer(user, params, body) {
    return runWithLogs(
      log,
      "raiseOffer",
      () => ({ id_user: user?.id_user, id_delivery: params?.id_delivery }),
      async () => {
        const ctx = await this._ctx(user?.id_user, params, { require: "resident" });
        if (ctx.error) return ctx;

        const delivery = await CommunityDeliveryStorage.getById(pool, params.id_delivery);
        if (!delivery || String(delivery.id_community) !== String(ctx.community.id_profile)) {
          return { error: "Chamado não encontrado.", statusCode: 404 };
        }
        if (String(delivery.id_requester) !== String(user.id_user)) {
          return { error: "Só quem abriu o chamado pode mudar a oferta.", statusCode: 403 };
        }

        const price = Math.round(Number(body?.price_cents));
        if (!Number.isFinite(price) || price <= Number(delivery.price_cents)) {
          return { error: "A nova oferta precisa ser maior que a atual.", statusCode: 400 };
        }
        if (price > MAX_OFFER_CENTS) {
          return { error: "Valor alto demais para uma corrida.", statusCode: 400 };
        }

        const updated = await CommunityDeliveryStorage.raiseOffer(
          pool,
          delivery.id_delivery,
          user.id_user,
          price
        );
        if (!updated) {
          return { error: "Este chamado não está mais aberto.", statusCode: 409 };
        }

        const band = updated.weight_band
          ? await getWeightBand(pool, updated.weight_band, { onlyActive: false })
          : null;
        this._broadcastOpened(ctx.community, updated, band, "raised").catch(() => {});
        push([updated.id_requester], { id_delivery: updated.id_delivery, status: updated.status });
        return { delivery: updated };
      }
    );
  }

  /**
   * A CONTRAPROPOSTA: acima de 10 kg o vizinho pode dizer "levo por R$X" em
   * vez de aceitar a oferta. Quem pediu escolhe depois.
   */
  static async propose(user, params, body) {
    return runWithLogs(
      log,
      "propose",
      () => ({ id_user: user?.id_user, id_delivery: params?.id_delivery }),
      async () => {
        const ctx = await this._ctx(user?.id_user, params, { require: "resident" });
        if (ctx.error) return ctx;

        const delivery = await CommunityDeliveryStorage.getById(pool, params.id_delivery);
        if (!delivery || String(delivery.id_community) !== String(ctx.community.id_profile)) {
          return { error: "Chamado não encontrado.", statusCode: 404 };
        }
        if (String(delivery.id_requester) === String(user.id_user)) {
          return { error: "Você não pode propor no seu próprio chamado.", statusCode: 400 };
        }
        if (!delivery.negotiable) {
          return { error: "Este chamado não aceita contraproposta.", statusCode: 400 };
        }
        if (
          delivery.status !== "open" ||
          delivery.id_courier ||
          new Date(delivery.expires_at) <= new Date()
        ) {
          return { error: "Este chamado não está mais aberto.", statusCode: 409 };
        }

        const block = await this._strikeBlock(user.id_user);
        if (block.blockedUntil) {
          return {
            error:
              "Você cancelou corridas demais nos últimos dias. Espere um pouco para aceitar outra.",
            statusCode: 429,
            blocked_until: block.blockedUntil,
          };
        }

        const amount = Math.round(Number(body?.amount_cents));
        const min = Number(delivery.min_price_cents) || 0;
        if (!Number.isFinite(amount) || amount <= 0 || amount < min) {
          return {
            error: `A proposta precisa ser de pelo menos ${brl(min)}.`,
            statusCode: 400,
          };
        }
        if (amount > MAX_OFFER_CENTS) {
          return { error: "Valor alto demais para uma corrida.", statusCode: 400 };
        }

        const proposal = await CommunityDeliveryStorage.upsertProposal(pool, {
          id_delivery: delivery.id_delivery,
          id_courier: user.id_user,
          amount_cents: amount,
          note: clean(body?.note, MAX_PROPOSAL_NOTE),
        });

        Promise.resolve(
          NotificationService.notifyDelivery({
            recipient_user_id: delivery.id_requester,
            actor_user_id: user.id_user,
            type: "delivery_proposal",
            id_community: ctx.community.id_profile,
            id_delivery: delivery.id_delivery,
            kind: delivery.kind,
            price_cents: amount,
            community_name: ctx.community.display_name,
          })
        ).catch(() => {});
        push([delivery.id_requester, user.id_user], {
          id_delivery: delivery.id_delivery,
          status: delivery.status,
          proposal: true,
        });

        return { proposal };
      }
    );
  }

  static async withdrawProposal(user, params) {
    return runWithLogs(
      log,
      "withdrawProposal",
      () => ({ id_user: user?.id_user, id_delivery: params?.id_delivery }),
      async () => {
        // Retirar a própria proposta é porta de saída: não passa pela flag.
        const ctx = await this._ctx(user?.id_user, params, {
          require: "resident",
          checkFlag: false,
        });
        if (ctx.error) return ctx;
        const row = await CommunityDeliveryStorage.withdrawProposal(
          pool,
          params.id_delivery,
          user.id_user
        );
        if (!row) {
          return { error: "Você não tem proposta aberta neste chamado.", statusCode: 404 };
        }
        const delivery = await CommunityDeliveryStorage.getById(pool, params.id_delivery);
        if (delivery) {
          push([delivery.id_requester, user.id_user], {
            id_delivery: delivery.id_delivery,
            proposal: true,
          });
        }
        return { proposal: row };
      }
    );
  }

  /**
   * Quem pediu escolhe uma contraproposta: vira o aceite daquele vizinho, pelo
   * valor dele. Mesmo caminho do aceite direto (`_lockAndCharge`) — o preço
   * novo entra na MESMA instrução que trava o chamado.
   */
  static async acceptProposal(user, params) {
    return runWithLogs(
      log,
      "acceptProposal",
      () => ({
        id_user: user?.id_user,
        id_delivery: params?.id_delivery,
        id_proposal: params?.id_proposal,
      }),
      async () => {
        const ctx = await this._ctx(user?.id_user, params, { require: "resident" });
        if (ctx.error) return ctx;

        const delivery = await CommunityDeliveryStorage.getById(pool, params.id_delivery);
        if (!delivery || String(delivery.id_community) !== String(ctx.community.id_profile)) {
          return { error: "Chamado não encontrado.", statusCode: 404 };
        }
        if (String(delivery.id_requester) !== String(user.id_user)) {
          return { error: "Só quem abriu o chamado escolhe a proposta.", statusCode: 403 };
        }

        const proposal = await CommunityDeliveryStorage.getProposal(pool, params.id_proposal);
        if (
          !proposal ||
          String(proposal.id_delivery) !== String(delivery.id_delivery) ||
          proposal.status !== "pending"
        ) {
          return { error: "Esta proposta não está mais disponível.", statusCode: 409 };
        }

        // O freio vale para QUEM VAI ENTREGAR, não para quem escolhe.
        const block = await this._strikeBlock(proposal.id_courier);
        if (block.blockedUntil) {
          return {
            error: "Este vizinho está temporariamente impedido de aceitar corridas.",
            statusCode: 429,
          };
        }

        return this._lockAndCharge(
          ctx,
          delivery,
          { id_user: proposal.id_courier },
          { price_cents: Number(proposal.amount_cents), id_proposal: proposal.id_proposal }
        );
      }
    );
  }

  /**
   * O modal "fulano quer enviar/receber" para todos os membros. O NOME de quem
   * pede vem do banco (a lista de membros traz o rosto), e não do token: o JWT
   * só carrega id e e-mail.
   */
  static async _broadcastOpened(community, delivery, band, reason) {
    const [ids, requester] = await Promise.all([
      CommunityDeliveryStorage.listMemberUserIds(pool, community.id_profile, delivery.id_requester),
      CommunityDeliveryStorage.getUserCard(pool, delivery.id_requester),
    ]);
    broadcast(ids, {
      reason,
      id_community: community.id_profile,
      community_name: community.display_name,
      id_delivery: delivery.id_delivery,
      requester_name: requester?.nome || requester?.username || null,
      requester_avatar: requester?.avatar || null,
      direction: delivery.direction,
      weight_band: delivery.weight_band,
      band_label: band?.label || null,
      price_cents: Number(delivery.price_cents),
      negotiable: delivery.negotiable === true,
      note: delivery.note || null,
      pickup: delivery.pickup || null,
      dropoff: delivery.dropoff || null,
    });
  }

  /* ------------------------------- entrega -------------------------------- */

  static async markDelivered(user, params) {
    return runWithLogs(
      log,
      "markDelivered",
      () => ({ id_user: user?.id_user, id_delivery: params?.id_delivery }),
      async () => {
        // Sem checar a flag: concluir uma corrida em pé não pode depender do
        // interruptor do admin.
        const ctx = await this._ctx(user?.id_user, params, {
          require: "resident",
          checkFlag: false,
        });
        if (ctx.error) return ctx;

        const delivery = await CommunityDeliveryStorage.getById(pool, params.id_delivery);
        if (!delivery || String(delivery.id_community) !== String(ctx.community.id_profile)) {
          return { error: "Chamado não encontrado.", statusCode: 404 };
        }
        // ⚠️ O prazo de confirmação sai do tipo DA LINHA e é lido com
        // `onlyActive: false`: desligar um tipo na tela de admin não pode deixar
        // sem prazo uma corrida daquele tipo que já está em pé — ela ficaria
        // `delivered` para sempre, sem liberar o repasse de ninguém.
        const t = await getDeliveryType(pool, delivery.kind, { onlyActive: false });
        const hours = Number(t?.confirm_hours) || 24;
        const now = new Date();

        const row = await CommunityDeliveryStorage.markDelivered(
          pool,
          params.id_delivery,
          user.id_user,
          {
            delivered_at: now,
            confirm_due_at: new Date(now.getTime() + hours * 60 * 60 * 1000),
          }
        );
        if (!row) {
          return { error: "Só quem aceitou este chamado pode marcar a entrega.", statusCode: 403 };
        }

        this._notifyDelivered(ctx.community, row).catch(() => {});
        push([row.id_requester, row.id_courier], { id_delivery: row.id_delivery, status: row.status });
        return { delivery: row };
      }
    );
  }

  /**
   * Quem PEDIU confirma que recebeu → o dinheiro vira saldo de quem entregou.
   *
   * ⚠️ Este é UM dos dois caminhos de conclusão; o outro é o prazo vencendo
   * (`sweepConfirmations`). Os dois terminam no MESMO `_complete`, e é por isso
   * que não há duas contas de repasse divergindo.
   */
  static async confirm(user, params) {
    return runWithLogs(
      log,
      "confirm",
      () => ({ id_user: user?.id_user, id_delivery: params?.id_delivery }),
      async () => {
        const ctx = await this._ctx(user?.id_user, params, {
          require: "resident",
          checkFlag: false,
        });
        if (ctx.error) return ctx;

        const delivery = await CommunityDeliveryStorage.getById(pool, params.id_delivery);
        if (!delivery || String(delivery.id_community) !== String(ctx.community.id_profile)) {
          return { error: "Chamado não encontrado.", statusCode: 404 };
        }
        if (String(delivery.id_requester) !== String(user.id_user)) {
          return { error: "Só quem pediu a entrega pode confirmar.", statusCode: 403 };
        }

        const done = await CommunityDeliveryStorage.markCompleted(pool, params.id_delivery, {
          completed_at: new Date(),
        });
        if (!done) {
          return { error: "Esta entrega ainda não foi marcada como entregue.", statusCode: 409 };
        }

        const payout = await this._createPayout(done);
        this._notifyConfirmed(ctx.community, done).catch(() => {});
        push([done.id_requester, done.id_courier], {
          id_delivery: done.id_delivery,
          status: done.status,
        });
        return { delivery: done, payout };
      }
    );
  }

  /* ----------------------------- cancelamentos ---------------------------- */

  /**
   * O entregador desiste — a qualquer momento (decisão do Alex) — e o dinheiro
   * VOLTA INTEIRO para quem pagou. A plataforma come a tarifa do gateway.
   *
   * ⚠️ O ESTORNO SAI DA INTENÇÃO (`provider_ref`), nunca do ambiente nem do
   * prefixo do id: a assinatura do Asaas e a do Stripe começam AMBAS com
   * `sub_`, e rotear por prefixo mandaria o estorno para o gateway errado, que
   * responderia "não encontrado" — com o dinheiro ficando com a gente.
   *
   * ⚠️ O CHAMADO VOLTA A FICAR ABERTO, não é morto: quem pediu continua
   * precisando da entrega, e matá-lo o obrigaria a abrir tudo de novo por uma
   * desistência que não foi dele.
   */
  static async releaseByCourier(user, params) {
    return runWithLogs(
      log,
      "releaseByCourier",
      () => ({ id_user: user?.id_user, id_delivery: params?.id_delivery }),
      async () => {
        const ctx = await this._ctx(user?.id_user, params, {
          require: "resident",
          checkFlag: false,
        });
        if (ctx.error) return ctx;

        const delivery = await CommunityDeliveryStorage.getById(pool, params.id_delivery);
        if (!delivery || String(delivery.id_community) !== String(ctx.community.id_profile)) {
          return { error: "Chamado não encontrado.", statusCode: 404 };
        }
        if (String(delivery.id_courier || "") !== String(user.id_user)) {
          return { error: "Você não aceitou este chamado.", statusCode: 403 };
        }

        // ⚠️ CHAMADO PRÉ-PAGO NÃO ESTORNA AQUI. Quando a entrega é o add-on de
        // uma compra (mig 249), a cobrança é a do PEDIDO INTEIRO — estorná-la
        // aqui devolveria também o dinheiro do produto, que está entregue. O
        // chamado volta para a fila e outro vizinho o pega; se a venda toda
        // precisar ser desfeita, quem faz isso é a disputa do pedido.
        const prepaid = !!delivery.id_listing_order;

        // Estorna ANTES de soltar a linha: soltando primeiro, os campos de
        // pagamento já teriam sido zerados e não haveria por onde achar a
        // cobrança para devolver.
        if (!prepaid && delivery.provider_ref && delivery.payment_status === "paid") {
          try {
            await PaymentGateway.refund({ provider_ref: delivery.provider_ref });
          } catch (err) {
            // Falha de estorno não pode prender a corrida: ela é registrada e
            // sai no radar de pendências, e o chamado segue para outra pessoa.
            log.error("release.refund.fail", {
              id_delivery: delivery.id_delivery,
              provider_ref: delivery.provider_ref,
              message: err?.message,
            });
          }
        }

        const t = await getDeliveryType(pool, delivery.kind, { onlyActive: false });
        const minutes = Number(t?.expires_minutes) || 1440;
        const row = prepaid
          ? await CommunityDeliveryStorage.releasePrepaidByCourier(
              pool,
              params.id_delivery,
              user.id_user,
              { expires_at: new Date(Date.now() + minutes * 60 * 1000) }
            )
          : await CommunityDeliveryStorage.releaseByCourier(
              pool,
              params.id_delivery,
              user.id_user,
              { expires_at: new Date(Date.now() + minutes * 60 * 1000) }
            );
        if (!row) return { error: "Esta corrida não está mais com você.", statusCode: 409 };

        // Se já havia repasse (entregou e depois desistiu), ele é revertido.
        await CommunityDeliveryStorage.revertPayout(pool, params.id_delivery);

        // O FREIO: três em sete dias travam aceitar por 24h.
        await CommunityDeliveryStorage.addStrike(pool, {
          id_user: user.id_user,
          id_community: ctx.community.id_profile,
          id_delivery: row.id_delivery,
        });

        this._notifyCanceled(ctx.community, row).catch(() => {});
        push([row.id_requester, user.id_user], { id_delivery: row.id_delivery, status: row.status });
        return { delivery: row };
      }
    );
  }

  /** Quem pediu desiste — só enquanto ninguém pegou (depois disso alguém já foi cobrado). */
  static async cancelByRequester(user, params) {
    return runWithLogs(
      log,
      "cancelByRequester",
      () => ({ id_user: user?.id_user, id_delivery: params?.id_delivery }),
      async () => {
        const ctx = await this._ctx(user?.id_user, params, {
          require: "resident",
          checkFlag: false,
        });
        if (ctx.error) return ctx;

        const row = await CommunityDeliveryStorage.cancelByRequester(
          pool,
          params.id_delivery,
          user.id_user,
          { canceled_at: new Date() }
        );
        if (!row) {
          return {
            error: "Não dá para cancelar: alguém já aceitou este chamado.",
            statusCode: 409,
          };
        }
        // Chamado cancelado não tem mais o que negociar (mig 266).
        CommunityDeliveryStorage.declinePendingProposals(pool, row.id_delivery).catch(() => {});
        push([row.id_requester], { id_delivery: row.id_delivery, status: row.status });
        return { delivery: row };
      }
    );
  }

  /* --------------------------- disponível agora --------------------------- */

  static async setAvailability(user, params, body) {
    return runWithLogs(
      log,
      "setAvailability",
      () => ({ id_user: user?.id_user, available: body?.available }),
      async () => {
        const ctx = await this._ctx(user?.id_user, params, { require: "resident" });
        if (ctx.error) return ctx;
        const row = await CommunityDeliveryStorage.setAvailability(
          pool,
          ctx.community.id_profile,
          user.id_user,
          body?.available !== false
        );
        return { availability: row };
      }
    );
  }

  /* ------------------------------- carteira ------------------------------- */

  static async myPayouts(user, query = {}) {
    return runWithLogs(log, "myPayouts", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
      const [items, summary] = await Promise.all([
        CommunityDeliveryStorage.listPayoutsForCourier(pool, user.id_user, { limit }),
        CommunityDeliveryStorage.summaryForCourier(pool, user.id_user),
      ]);
      return { items, summary };
    });
  }

  /* -------------------------------- webhook ------------------------------- */

  /**
   * O pagamento do aceite caiu.
   *
   * ⚠️ IDEMPOTENTE POR SESSION ID. O webhook é at-least-once: a reentrega cai
   * no `WHERE payment_status = 'pending'` do storage, devolve zero linhas e sai
   * por `{ already: true }` — nunca cobrando nem creditando duas vezes.
   *
   * ⚠️ E É AQUI QUE A TARIFA REAL SUBSTITUI A ESTIMATIVA, antes de qualquer
   * repasse existir: `fee` no Stripe, `value − netValue` no Asaas. Não apurar
   * NÃO é tarifa zero — `getChargeFee` devolve `null` quando não consegue ler,
   * e assumir zero pagaria ao entregador dinheiro que o gateway já reteve. Sem
   * número, a estimativa fica e `processor_fee_source` segue dizendo
   * `fallback`, que é como se descobre depois quais repasses saíram no palpite.
   */
  static async confirmStripeSession(session) {
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;

    const row = await CommunityDeliveryStorage.markPaid(pool, session.id, paymentIntentId);
    if (!row) {
      const existing = await CommunityDeliveryStorage.getBySession(pool, session.id);
      if (existing?.payment_status === "paid") return { already: true };
      return { error: "Chamado de entrega não encontrado para esta sessão." };
    }

    try {
      // No Stripe a taxa é lida pelo payment_intent; no Asaas a cobrança É a
      // referência. `provider_ref` cobre os dois, com o PI como alternativa.
      const fee = await PaymentGateway.getChargeFee(paymentIntentId || row.provider_ref);
      const cents = Number(fee?.fee_cents);
      if (Number.isFinite(cents)) {
        const updated = await CommunityDeliveryStorage.applyProcessorFee(
          pool,
          row.id_delivery,
          Math.max(0, Math.round(cents))
        );
        if (updated) {
          log.info("delivery.processor_fee.applied", {
            id_delivery: row.id_delivery,
            estimated_cents: Number(row.processor_fee_cents) || 0,
            real_cents: Math.max(0, Math.round(cents)),
            courier_cents: Number(updated.courier_cents) || 0,
          });
          return { delivery: updated };
        }
      } else {
        log.warn("delivery.processor_fee.unavailable", { id_delivery: row.id_delivery });
      }
    } catch (err) {
      // Falha de apuração não derruba a confirmação de um pagamento que já
      // aconteceu — a corrida vale, e o repasse sai na estimativa.
      log.warn("delivery.processor_fee.fail", {
        id_delivery: row.id_delivery,
        message: err?.message,
      });
    }
    return { delivery: row };
  }

  /**
   * A sessão expirou sem pagamento: o chamado volta para a fila.
   *
   * ⚠️ NÃO É "cancelar a corrida": quem pediu continua querendo a entrega, e
   * quem aceitou não fez nada de errado — o cartão é que não passou. O chamado
   * reabre para outra pessoa, exatamente como no cancelamento do entregador,
   * mas SEM strike (não houve desistência).
   */
  static async expireBySession(session_id) {
    const row = await CommunityDeliveryStorage.getBySession(pool, session_id);
    if (!row || row.payment_status !== "pending") return false;
    const t = await getDeliveryType(pool, row.kind, { onlyActive: false });
    const minutes = Number(t?.expires_minutes) || 1440;
    const released = await CommunityDeliveryStorage.releaseByCourier(
      pool,
      row.id_delivery,
      row.id_courier,
      { expires_at: new Date(Date.now() + minutes * 60 * 1000) }
    );
    if (released) {
      push([released.id_requester, row.id_courier], {
        id_delivery: released.id_delivery,
        status: released.status,
      });
    }
    return !!released;
  }

  /**
   * Estorno total → a corrida é desfeita e o repasse revertido.
   *
   * Contrato da cadeia de `charge.refunded`: devolve `{ ignored: true }` quando
   * o charge não é desta feature, para o próximo da fila tentar.
   */
  static async handleChargeRefunded(charge) {
    const paymentIntentId =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id || null;
    if (!paymentIntentId) return { ignored: true };

    const row = await CommunityDeliveryStorage.getByProviderRef(pool, paymentIntentId);
    if (!row) return { ignored: true };

    if (!isFullRefund(charge)) {
      log.warn("delivery.refund.partial_ignored", {
        id_delivery: row.id_delivery,
        amount_refunded: charge.amount_refunded,
      });
      return { handled: false, partial: true };
    }

    await CommunityDeliveryStorage.revertPayout(pool, row.id_delivery);
    await pool.query(
      `UPDATE public.tb_community_delivery_request
          SET payment_status = 'refunded',
              status = CASE WHEN status IN ('canceled','expired') THEN status ELSE 'canceled' END,
              canceled_at = COALESCE(canceled_at, NOW()),
              cancel_reason = COALESCE(cancel_reason, 'admin'),
              updated_at = NOW()
        WHERE id_delivery = $1`,
      [row.id_delivery]
    );
    log.info("delivery.refunded", { id_delivery: row.id_delivery });
    return { handled: true };
  }

  /* ------------------------------- sweepers ------------------------------- */

  /**
   * Chamado aberto que ninguém pegou morre sozinho.
   *
   * ⚠️ E MORRE SEM COBRAR NINGUÉM — é a decisão 4 do Alex virando código: a
   * cobrança só nasce no aceite, então a linha expirada nunca teve
   * `session_id`. O teste confere exatamente isso.
   */
  static async sweepExpired() {
    return runWithLogs(log, "sweepExpired", () => ({}), async () => {
      const rows = await CommunityDeliveryStorage.expireDue(pool);
      if (rows.length) log.info("delivery.expired", { count: rows.length });
      for (const r of rows) push([r.id_requester], { id_delivery: r.id_delivery, status: "expired" });
      return { expired: rows.length };
    });
  }

  /**
   * Entregue e não confirmado dentro do prazo → conclui sozinho e vira saldo.
   *
   * ⚠️ É ele que fecha a fraude de quem recebe a encomenda e nunca confirma
   * para não pagar.
   */
  static async sweepConfirmations() {
    return runWithLogs(log, "sweepConfirmations", () => ({}), async () => {
      const rows = await CommunityDeliveryStorage.releaseDueConfirmations(pool);
      for (const row of rows) {
        try {
          await this._createPayout(row);
          push([row.id_requester, row.id_courier], {
            id_delivery: row.id_delivery,
            status: "completed",
          });
        } catch (err) {
          log.error("delivery.autorelease.payout_fail", {
            id_delivery: row.id_delivery,
            message: err?.message,
          });
        }
      }
      if (rows.length) log.info("delivery.auto_completed", { count: rows.length });
      return { completed: rows.length };
    });
  }

  /* ------------------------------- internos ------------------------------- */

  /**
   * O repasse.
   *
   * ⚠️ SEM HOLDBACK, E ISSO NÃO É ESQUECIMENTO. O holdback de 8 dias existe
   * para a Loja (CDC: compra remota de bem, 7 dias de arrependimento). Aqui é
   * entrega em mãos dentro do prédio, confirmada explicitamente por quem
   * pediu — não há arrependimento de uma corrida que já terminou. E o valor é
   * pequeno: segurar R$1,01 por oito dias mata a feature, porque ninguém
   * carrega um sofá por dinheiro que chega na semana que vem.
   *
   * ⚠️ NÃO "CONSERTAR" ISTO DEPOIS achando que faltou holdback. O sub-projeto 3
   * (venda dentro da vitrine) é OUTRO regime e lá o holdback VOLTA.
   *
   * ⚠️ CORRIDA NÃO PAGA NÃO GERA REPASSE. `payment_status !== 'paid'` acontece
   * quando o webhook ainda não chegou ou quando a sessão caducou — creditar
   * nesse estado criaria saldo sacável a partir de dinheiro que não entrou.
   */
  static async _createPayout(delivery) {
    if (!delivery?.id_courier) return null;
    if (delivery.payment_status !== "paid") {
      log.info("delivery.payout.skip_unpaid", {
        id_delivery: delivery.id_delivery,
        payment_status: delivery.payment_status,
      });
      return null;
    }
    const net = Math.max(0, Number(delivery.courier_cents) || 0);
    return CommunityDeliveryStorage.createPayout(pool, {
      id_delivery: delivery.id_delivery,
      id_community: delivery.id_community,
      id_courier: delivery.id_courier,
      kind: delivery.kind,
      charge_cents: Number(delivery.price_cents) || 0,
      processor_fee_cents: Number(delivery.processor_fee_cents) || 0,
      net_cents: net,
    });
  }

  /** Até quando esta pessoa está impedida de aceitar. `null` = liberada. */
  static async _strikeBlock(id_user) {
    const { count, last_at } = await CommunityDeliveryStorage.countRecentStrikes(
      pool,
      id_user,
      STRIKE_WINDOW_DAYS
    );
    if (count < STRIKE_LIMIT || !last_at) return { count, blockedUntil: null };
    const until = new Date(new Date(last_at).getTime() + STRIKE_BLOCK_HOURS * 60 * 60 * 1000);
    return { count, blockedUntil: until > new Date() ? until : null };
  }

  /* ----------------------------- notificações ----------------------------- */

  static async _notifyOpened(community, delivery) {
    const ids = await CommunityDeliveryStorage.listAvailableUserIds(
      pool,
      community.id_profile,
      delivery.id_requester
    );
    for (const id of ids) {
      await NotificationService.notifyDelivery({
        recipient_user_id: id,
        actor_user_id: delivery.id_requester,
        type: "delivery_opened",
        id_community: community.id_profile,
        id_delivery: delivery.id_delivery,
        kind: delivery.kind,
        price_cents: delivery.price_cents,
        community_name: community.display_name,
      });
    }
    push(ids, { id_delivery: delivery.id_delivery, status: "open" });
  }

  static async _notifyAccepted(community, delivery, courier) {
    return NotificationService.notifyDelivery({
      recipient_user_id: delivery.id_requester,
      actor_user_id: courier.id_user,
      type: "delivery_accepted",
      id_community: community.id_profile,
      id_delivery: delivery.id_delivery,
      kind: delivery.kind,
      price_cents: delivery.price_cents,
      community_name: community.display_name,
    });
  }

  static async _notifyDelivered(community, delivery) {
    return NotificationService.notifyDelivery({
      recipient_user_id: delivery.id_requester,
      actor_user_id: delivery.id_courier,
      type: "delivery_delivered",
      id_community: community.id_profile,
      id_delivery: delivery.id_delivery,
      kind: delivery.kind,
      price_cents: delivery.price_cents,
      community_name: community.display_name,
    });
  }

  static async _notifyConfirmed(community, delivery) {
    return NotificationService.notifyDelivery({
      recipient_user_id: delivery.id_courier,
      actor_user_id: delivery.id_requester,
      type: "delivery_confirmed",
      id_community: community.id_profile,
      id_delivery: delivery.id_delivery,
      kind: delivery.kind,
      // ⚠️ O aviso de "recebido" carrega o LÍQUIDO, não o preço: é ele que vai
      // cair na carteira, e anunciar o bruto aqui seria a mesma promessa
      // quebrada que a tela de aceite existe para evitar.
      price_cents: delivery.courier_cents,
      community_name: community.display_name,
    });
  }

  static async _notifyCanceled(community, delivery) {
    return NotificationService.notifyDelivery({
      recipient_user_id: delivery.id_requester,
      actor_user_id: null,
      type: "delivery_canceled",
      id_community: community.id_profile,
      id_delivery: delivery.id_delivery,
      kind: delivery.kind,
      price_cents: delivery.price_cents,
      community_name: community.display_name,
    });
  }
}

module.exports = CommunityDeliveryService;
