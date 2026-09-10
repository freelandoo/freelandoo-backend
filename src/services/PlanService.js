// src/services/PlanService.js
// Planos mensais (mig 225): o que a pessoa assina e o que isso libera.
//
// ─── ESTE MÓDULO É A FONTE DA POSSE POR PLANO ───────────────────────────────
//
// `hasFeature` é a pergunta que toda porta paga faz. Ela responde na ordem, e a
// ordem não pode mudar:
//
//   1. comprou vitalício  → TEM, e ponto. Vender vitalício e depois exigir
//      assinatura da mesma pessoa seria retomar o que já foi pago.
//   2. a chave está em plano ativo → tem SE assina.
//   3. nem uma coisa nem outra → cai na regra antiga da Loja (à venda = só
//      quem comprou; fora de venda = grátis).
//
// ─── O QUE ACONTECE QUANDO A ASSINATURA ACABA ───────────────────────────────
//
// A pessoa perde as PORTAS, não o que já é dela: o site publicado continua no
// ar, o histórico do WhatsApp continua na caixa, os agendamentos marcados
// continuam de pé. O que ela deixa de poder é abrir coisa nova — e a sessão do
// WhatsApp cai, porque essa custa dinheiro por dia parada.

const pool = require("../databases");
const PlanStorage = require("../storages/PlanStorage");
const FunctionStoreStorage = require("../storages/FunctionStoreStorage");
const StripeService = require("./StripeService");
const { BUSINESS_GATES, BUSINESS_GATE_KEYS } = require("../utils/businessPlan");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("PlanService");

class PlanService {
  /* ──────────────────────────────── catálogo ───────────────────────────── */

  static async listPlans(id_user) {
    return runWithLogs(log, "listPlans", () => ({ id_user }), async () => {
      const [plans, subscription] = await Promise.all([
        PlanStorage.listPlans(pool, { onlyActive: true }),
        id_user ? PlanStorage.getActiveSubscription(pool, id_user) : null,
      ]);
      return {
        plans,
        subscription: subscription ? this._publicSubscription(subscription) : null,
      };
    });
  }

  static async mySubscription(id_user) {
    return runWithLogs(log, "mySubscription", () => ({ id_user }), async () => {
      const s = await PlanStorage.getActiveSubscription(pool, id_user);
      return { subscription: s ? this._publicSubscription(s) : null };
    });
  }

  /* ──────────────────────────────── posse ──────────────────────────────── */

  /**
   * O mapa completo de posse do usuário, na ordem descrita no topo.
   *
   * Devolvido também sem `id_user` (visitante): tudo que não é grátis vem
   * `false`, e nenhuma tela precisa de um caminho especial para deslogado.
   */
  static async ownershipMap(id_user, featureKeys) {
    const [products, ownedKeys, planKeys, subscribedKeys] = await Promise.all([
      FunctionStoreStorage.listProducts(pool),
      id_user ? FunctionStoreStorage.listOwnedKeys(pool, id_user) : [],
      PlanStorage.featureKeysInAnyPlan(pool),
      id_user ? PlanStorage.subscribedFeatureKeys(pool, id_user) : [],
    ]);

    const owned = new Set(ownedKeys);
    const inPlan = new Set(planKeys);
    const subscribed = new Set(subscribedKeys);

    const map = {};
    for (const key of featureKeys) {
      const product = products.find((p) => p.feature_key === key);
      if (owned.has(key)) {
        map[key] = true; // 1. vitalício vence tudo
      } else if (inPlan.has(key)) {
        map[key] = subscribed.has(key); // 2. é de plano: só assinante
      } else {
        map[key] = !product || !product.is_for_sale; // 3. regra antiga da Loja
      }
    }
    return map;
  }

  /** Uma chave só. Mesma ordem, sem montar o mapa inteiro. */
  static async hasFeature(id_user, feature_key) {
    if (!id_user) return false;
    const owned = await FunctionStoreStorage.listOwnedKeys(pool, id_user);
    if (owned.includes(feature_key)) return true;

    const inPlan = await PlanStorage.featureKeysInAnyPlan(pool);
    if (inPlan.includes(feature_key)) {
      const subscribed = await PlanStorage.subscribedFeatureKeys(pool, id_user);
      return subscribed.includes(feature_key);
    }

    const product = await FunctionStoreStorage.getProductByKey(pool, feature_key);
    return !product || !product.is_for_sale;
  }

  /**
   * As três portas do Plano NEGÓCIO (mig 234) para UMA pessoa — o líder de um
   * negócio — num mapa só: `{ members_enabled, site_share_enabled, ai_enabled }`.
   *
   * É o que a página da comunidade recebe para saber se mostra "Entrar" ao
   * visitante e o aviãozinho ao líder. Sem líder (plataforma) tudo é falso.
   */
  static async businessGates(id_leader_user) {
    if (!id_leader_user) {
      return { members_enabled: false, site_share_enabled: false, ai_enabled: false };
    }
    const map = await PlanService.ownershipMap(id_leader_user, BUSINESS_GATE_KEYS);
    return {
      members_enabled: !!map[BUSINESS_GATES.members],
      site_share_enabled: !!map[BUSINESS_GATES.siteShare],
      ai_enabled: !!map[BUSINESS_GATES.ai],
    };
  }

  /**
   * A recusa de uma porta do plano, pronta para o `sendServiceResult`: 402 com
   * o motivo escrito. O front reconhece o plano pelo STATUS (402) — o corpo de
   * erro só carrega `error`.
   */
  static async planRefusal(feature_key, message) {
    const plan = await PlanService.planSellingFeature(feature_key);
    return {
      error: plan ? `${message} Faz parte do plano ${plan.name}.` : message,
      statusCode: 402,
      needs_plan: plan ? plan.slug : null,
    };
  }

  /**
   * O plano que vende esta chave — para a recusa dizer o que fazer.
   *
   * Uma porta paga que responde só "indisponível" manda a pessoa procurar o
   * problema; dizendo o nome e o preço do plano, ela sabe o caminho.
   */
  static async planSellingFeature(feature_key) {
    const plans = await PlanStorage.listPlans(pool, { onlyActive: true });
    return plans.find((p) => (p.features || []).includes(feature_key)) || null;
  }

  /* ─────────────────────────────── ciclo de vida ───────────────────────── */

  /**
   * Encerra a assinatura no nosso lado. Chamado pelo webhook
   * (`customer.subscription.deleted`) e pelo cancelamento a pedido.
   *
   * ⚠️ O `require` do WhatsappService é LAZY, dentro da função, e não no topo
   * do arquivo: o WhatsappService importa este módulo para gatear a conexão, e
   * os dois no topo fariam um ciclo de require — que em Node não estoura, só
   * entrega um objeto pela metade, num erro que aparece longe daqui.
   */
  static async endSubscription(id_subscription, id_user) {
    const row = await PlanStorage.setStatus(pool, id_subscription, "canceled");

    // O atendente de IA INCLUÍDO (mig 234) cai junto com o plano: ele é o
    // outro recurso que continuaria custando (tokens de LLM) depois do fim. Só
    // a assinatura marcada como incluída cai — quem paga o Atendimento IA à
    // parte não é tocado. `require` lazy pelo mesmo motivo do WhatsApp abaixo.
    try {
      const AtendimentoIaService = require("./AtendimentoIaService");
      await AtendimentoIaService.revokeIncluded(id_subscription);
    } catch (e) {
      log.warn("endSubscription.ai_revoke_failed", { message: e && e.message });
    }

    // A sessão do WhatsApp é o único recurso que continuaria CUSTANDO depois do
    // fim do plano — uma sessão de pé consome memória todo dia, pagando ou não.
    // O histórico fica; o que cai é a conexão.
    try {
      const WhatsappService = require("./WhatsappService");
      await WhatsappService.disconnect(id_user || (row && row.id_user));
    } catch (e) {
      log.warn("endSubscription.whatsapp_disconnect_failed", { message: e && e.message });
    }
    return row;
  }


  /* ─────────────────────────────── checkout ────────────────────────────── */

  /**
   * Abre o checkout do plano. Assinatura MENSAL com `price_data` ad-hoc — o
   * mesmo caminho da comunidade privada (mig 173) e do Atendimento IA (175),
   * que é o que deixa o admin reajustar o preço sem tocar no dashboard do
   * Stripe.
   *
   * ⚠️ Quem já assina é RECUSADO aqui, e não deixado seguir para o Stripe: a
   * unicidade viva (`ux_user_plan_active`) faria a ativação do webhook estourar
   * DEPOIS de a pessoa ter pagado — cobrança feita, acesso não entregue.
   * Trocar de plano é cancelar e assinar de novo.
   */
  static async createCheckout(user, slug, { successUrl, cancelUrl } = {}) {
    const id_user = user && user.id_user;
    return runWithLogs(log, "createCheckout", () => ({ id_user, slug }), async () => {
      if (!id_user) return { error: "Não autenticado", statusCode: 401 };
      const plan = await PlanStorage.getPlanBySlug(pool, slug);
      if (!plan || !plan.is_active) return { error: "Plano não encontrado", statusCode: 404 };

      const current = await PlanStorage.getActiveSubscription(pool, id_user);
      if (current) {
        return {
          error:
            current.slug === slug
              ? "Você já assina este plano."
              : `Você já assina o plano ${current.name}. Cancele antes de trocar.`,
          statusCode: 409,
        };
      }

      const session = await StripeService.createMonthlySubscriptionCheckoutSession({
        amount_cents: plan.price_cents,
        productName: `Plano ${plan.name}`,
        customerEmail: user.email || undefined,
        clientReferenceId: String(id_user),
        successUrl,
        cancelUrl,
        // `type` é o que o webhook lê para saber de quem é a fatura quando ela
        // chega ANTES do checkout.session.completed — sem ele, a linha
        // `pending` nunca seria encontrada e o pagamento ficaria órfão.
        metadata: {
          type: "plan_subscription",
          id_user: String(id_user),
          id_plan: String(plan.id_plan),
        },
      });

      await PlanStorage.createPending(pool, {
        id_user,
        id_plan: plan.id_plan,
        price_cents: plan.price_cents,
        stripe_session_id: session.id,
      });

      return { checkout_url: session.url, session_id: session.id };
    });
  }

  /** Cancelamento a pedido: encerra no Stripe no FIM do período já pago. */
  static async cancelMySubscription(id_user) {
    return runWithLogs(log, "cancelMySubscription", () => ({ id_user }), async () => {
      const sub = await PlanStorage.getActiveSubscription(pool, id_user);
      if (!sub) return { error: "Você não tem assinatura ativa", statusCode: 404 };

      // O acesso segue até o fim do que foi pago — cortar no clique devolveria
      // menos do que a pessoa comprou. Quem encerra de fato é o webhook
      // `customer.subscription.deleted`, quando o período acaba.
      if (sub.stripe_subscription_id) {
        try {
          await StripeService.cancelSubscription(sub.stripe_subscription_id);
        } catch (e) {
          log.warn("cancel.stripe_fail", { message: e && e.message });
          return { error: "Não foi possível cancelar agora. Tente de novo.", statusCode: 502 };
        }
      } else {
        // Assinatura sem id do Stripe é linha pendente/manual: encerra aqui.
        await PlanService.endSubscription(sub.id_subscription, id_user);
      }
      return { canceled: true, active_until: sub.current_period_end };
    });
  }

  /* ─────────────────────────────── webhook ─────────────────────────────── */
  //
  // Todos devolvem `{ ignored: true }` quando a fatura NÃO é de plano: é assim
  // que a cadeia do webhook (StripeWebhookService) passa a vez para o próximo
  // fluxo em vez de engolir o evento de outro.

  static async confirmStripeSession(session) {
    const row = await PlanStorage.getBySessionId(pool, session.id);
    if (!row) return { ignored: true };
    if (row.status === "active" || row.status === "past_due") return { already: true };

    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription && session.subscription.id
          ? session.subscription.id
          : null;
    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer && session.customer.id
          ? session.customer.id
          : null;

    await PlanStorage.activate(pool, row.id_subscription, {
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
      current_period_end: null,
    });
    await PlanService._afterActivation(row.id_user, row.id_subscription);
    return { activated: true, id_user: row.id_user };
  }

  static async handleInvoicePaid(invoice, subscriptionId) {
    const row = await PlanStorage.getByStripeSubscription(pool, subscriptionId);
    if (!row) return { ignored: true };
    await PlanStorage.activate(pool, row.id_subscription, {
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: null,
      current_period_end: PlanService._periodEnd(invoice),
    });
    await PlanService._afterActivation(row.id_user, row.id_subscription);
    return { renewed: true, id_user: row.id_user };
  }

  /**
   * A fatura chegou antes do `checkout.session.completed` — a linha ainda não
   * tem o id da assinatura, e quem diz de quem ela é é a metadata.
   */
  static async handleInvoicePaidByMetadata(invoice, subscription) {
    const meta = (subscription && subscription.metadata) || {};
    if (meta.type !== "plan_subscription") return { ignored: true };
    const id_user = meta.id_user || null;
    const id_plan = meta.id_plan || null;
    if (!id_user || !id_plan) return { ignored: true };

    const existing = await PlanStorage.getActiveSubscription(pool, id_user);
    if (existing) return { already: true };

    const plan = await PlanStorage.getPlanById(pool, id_plan);
    if (!plan) return { ignored: true };

    const created = await PlanStorage.createPending(pool, {
      id_user,
      id_plan,
      price_cents: plan.price_cents,
      stripe_session_id: null,
    });
    await PlanStorage.activate(pool, created.id_subscription, {
      stripe_subscription_id: subscription.id,
      stripe_customer_id:
        typeof subscription.customer === "string" ? subscription.customer : null,
      current_period_end: PlanService._periodEnd(invoice),
    });
    await PlanService._afterActivation(id_user, created.id_subscription);
    return { activated: true, id_user };
  }

  static async handleInvoiceFailed(subscriptionId) {
    const row = await PlanStorage.getByStripeSubscription(pool, subscriptionId);
    if (!row) return { ignored: true };
    // `past_due` MANTÉM o acesso: o Stripe ainda vai tentar cobrar, e derrubar
    // o site e o WhatsApp de quem só trocou de cartão é desproporcional.
    await PlanStorage.setStatus(pool, row.id_subscription, "past_due");
    return { past_due: true, id_user: row.id_user };
  }

  static async handleSubscriptionDeleted(subscription) {
    const row = await PlanStorage.getByStripeSubscription(pool, subscription.id);
    if (!row) return { ignored: true };
    await PlanService.endSubscription(row.id_subscription, row.id_user);
    return { canceled: true, id_user: row.id_user };
  }

  /**
   * O que a ativação (ou renovação) do plano ABRE além da posse: hoje, o
   * atendente de IA incluído. Best-effort e fora do caminho do webhook — falha
   * aqui não pode fazer o Stripe reentregar uma fatura já aplicada.
   */
  static async _afterActivation(id_user, id_subscription) {
    try {
      const sub = await PlanStorage.getActiveSubscription(pool, id_user);
      if (!sub || String(sub.id_subscription) !== String(id_subscription)) return;
      if (!(sub.features || []).includes(BUSINESS_GATES.ai)) return;
      const AtendimentoIaService = require("./AtendimentoIaService");
      await AtendimentoIaService.syncIncluded(id_user, id_subscription);
    } catch (e) {
      log.warn("afterActivation.failed", { id_user, message: e && e.message });
    }
  }

  static _periodEnd(invoice) {
    const line = invoice && invoice.lines && invoice.lines.data && invoice.lines.data[0];
    const secs = (line && line.period && line.period.end) || (invoice && invoice.period_end) || null;
    return secs ? new Date(secs * 1000) : null;
  }

  /* ──────────────────────────────── apoio ──────────────────────────────── */

  static _publicSubscription(s) {
    return {
      id_subscription: s.id_subscription,
      plan_slug: s.slug,
      plan_name: s.name,
      tagline: s.tagline,
      status: s.status,
      price_cents: s.price_cents,
      features: s.features || [],
      current_period_end: s.current_period_end,
      started_at: s.started_at,
      // O id da assinatura no Stripe NÃO sai daqui: é identificador de
      // integração, não informação do cliente.
    };
  }
}

module.exports = PlanService;
