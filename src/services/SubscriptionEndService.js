// src/services/SubscriptionEndService.js
// "Cancelar no fim do ciclo" — a capacidade que só o Stripe tinha.
//
// ─── ⚠️ O DEFEITO QUE ISTO FECHA TIRA MÊS PAGO DE ASSINANTE ─────────────────
//
// Quatro lugares cancelam assinatura pedindo "no fim do ciclo". No Stripe isso
// funciona (`cancel_at_period_end` é nativo). Fora dele NÃO EXISTE: o Asaas só
// tinha `DELETE` e o Mercado Pago só tem `PUT status=cancelled`, os dois
// IMEDIATOS. O `immediate: false` chegava ao adapter e era ignorado.
//
// Quem cancelava no dia 3 perdia o acesso NO DIA 3, com o mês inteiro pago. E
// não aparecia erro nenhum — a chamada "funcionava".
//
// ─── A CAPACIDADE MORA NO ADAPTER, E ISSO É O DESENHO ───────────────────────
//
// `SUPPORTS_PERIOD_END` é declarado por provedor. Quem TEM o recurso nativo
// (Stripe) continua usando o dele, sem passar por fila nenhuma — é mais
// confiável que qualquer agendamento nosso, porque a decisão fica do lado de
// quem cobra. Quem NÃO tem cai na fila da mig 251.
//
// ⚠️ Provedor NOVO declara `SUPPORTS_PERIOD_END`. Esquecendo, o valor é
// `undefined` (falsy) e ele cai na fila — que é o lado SEGURO do erro: no pior
// caso a plataforma agenda algo que o gateway saberia fazer sozinho. O
// contrário (assumir que sabe) voltaria a tirar mês pago de assinante.

const pool = require("../databases");
const PaymentGateway = require("../integrations/payments");
const SubscriptionEndStorage = require("../storages/SubscriptionEndStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("SubscriptionEndService");

const ONE_HOUR = 60 * 60 * 1000;

/**
 * Cancela a assinatura preservando o ciclo JÁ PAGO.
 *
 * Substitui as chamadas `PaymentGateway.cancelSubscription(id)` sem
 * `immediate` — que é o que os quatro fluxos faziam.
 */
async function cancelAtPeriodEnd({ subscriptionId, id_user = null, reason = null } = {}) {
  return runWithLogs(
    log,
    "cancelAtPeriodEnd",
    () => ({ subscriptionId, id_user, reason }),
    async () => {
      if (!subscriptionId) return { ignored: true, reason: "no_subscription_id" };

      const provider = await PaymentGateway.resolveProviderByRef(subscriptionId);
      const impl = PaymentGateway.PROVIDERS[provider];

      // ── Quem tem o recurso nativo usa o dele ─────────────────────────────
      //
      // ⚠️ `cancel_at` SAI NORMALIZADO nos dois caminhos, e isso não é enfeite:
      // quem chama grava essa data (`canceled_at`) e a mostra para a pessoa
      // como "seu acesso vale até". Deixar o caller ler `cancel_at` cru do
      // Stripe o amarraria ao formato dele (epoch em segundos) e, no provedor
      // sem suporte nativo, o campo simplesmente não viria — a tela diria
      // "até null".
      if (impl && impl.SUPPORTS_PERIOD_END === true) {
        const res = await PaymentGateway.cancelSubscription(subscriptionId, {
          provider,
          immediate: false,
        });
        const epoch =
          res && Number.isFinite(res.cancel_at)
            ? res.cancel_at
            : res && Number.isFinite(res.current_period_end)
              ? res.current_period_end
              : null;
        return {
          scheduled: false,
          native: true,
          provider,
          cancel_at: epoch ? new Date(epoch * 1000) : null,
          raw: res,
        };
      }

      // ── Quem não tem: descobre o fim do ciclo e agenda ───────────────────
      let periodEnd = null;
      try {
        const period = await PaymentGateway.getSubscriptionPeriod(subscriptionId, { provider });
        periodEnd = period && period.period_end ? new Date(period.period_end) : null;
      } catch (err) {
        log.warn("period.read_fail", { subscriptionId, provider, message: err && err.message });
      }

      const valid = periodEnd instanceof Date && !Number.isNaN(periodEnd.getTime());

      // ⚠️ NÃO SABER O FIM DO CICLO CANCELA AGORA, e a escolha é deliberada.
      //
      // As duas saídas são ruins e não são equivalentes:
      //   * cancelar agora → a pessoa perde, no MÁXIMO, o resto de um mês pago.
      //   * não cancelar   → o cartão dela segue sendo debitado. Todo mês. Para
      //                      sempre. Depois de ela ter pedido para sair.
      //
      // A segunda é pior por uma ordem de grandeza, e é a única que fica
      // invisível — ninguém reclama do acesso que continuou funcionando.
      if (!valid) {
        log.warn("period.unknown_cancel_now", { subscriptionId, provider });
        await PaymentGateway.cancelSubscription(subscriptionId, { provider, immediate: true });
        return { scheduled: false, immediate: true, provider, reason: "period_unknown" };
      }

      // Ciclo já vencido: não há mês pago a preservar.
      if (periodEnd.getTime() <= Date.now()) {
        await PaymentGateway.cancelSubscription(subscriptionId, { provider, immediate: true });
        return { scheduled: false, immediate: true, provider, reason: "period_already_over" };
      }

      const row = await SubscriptionEndStorage.schedule(pool, {
        provider,
        provider_ref: subscriptionId,
        id_user,
        cancel_at: periodEnd,
        reason,
      });

      log.info("scheduled", {
        subscriptionId,
        provider,
        cancel_at: periodEnd.toISOString(),
      });
      return {
        scheduled: true,
        provider,
        cancel_at: periodEnd,
        id_subscription_end: row && row.id_subscription_end,
      };
    }
  );
}

/** A pessoa voltou atrás antes do vencimento: a agenda sai de cena. */
async function releaseSchedule(subscriptionId) {
  if (!subscriptionId) return null;
  const provider = await PaymentGateway.resolveProviderByRef(subscriptionId);
  return SubscriptionEndStorage.release(pool, provider, subscriptionId);
}

/**
 * Executa o que venceu.
 *
 * ⚠️ UMA FALHA NÃO DERRUBA AS OUTRAS. Cada linha tem try/catch próprio: um id
 * que o gateway não reconhece mais não pode impedir o cancelamento das
 * assinaturas seguintes da fila — que é dinheiro saindo do cartão de gente que
 * pediu para sair.
 */
async function runDue({ limit = 50 } = {}) {
  return runWithLogs(log, "runDue", () => ({ limit }), async () => {
    const due = await SubscriptionEndStorage.listDue(pool, { limit });
    if (due.length === 0) return { due: 0, canceled: 0, failed: 0 };

    let canceled = 0;
    let failed = 0;

    for (const row of due) {
      try {
        await PaymentGateway.cancelSubscription(row.provider_ref, {
          provider: row.provider,
          immediate: true,
        });
        await SubscriptionEndStorage.markDone(pool, row.id_subscription_end);
        canceled++;
        log.info("canceled", {
          id_subscription_end: row.id_subscription_end,
          provider: row.provider,
        });
      } catch (err) {
        failed++;
        const after = await SubscriptionEndStorage.markAttemptFailed(
          pool,
          row.id_subscription_end,
          err && err.message
        );
        // ⚠️ ERROR só no último fôlego: antes disso é retry normal, e um WARN
        // por volta do sweeper esconderia as falhas que importam.
        const level = after && after.status === "failed" ? "error" : "warn";
        log[level]("cancel_fail", {
          id_subscription_end: row.id_subscription_end,
          provider: row.provider,
          attempts: after && after.attempts,
          message: err && err.message,
        });
      }
    }

    return { due: due.length, canceled, failed };
  });
}

/**
 * ⚠️ A CADÊNCIA É DE 1 HORA e isso é de propósito: a granularidade de "fim do
 * ciclo" é o DIA, então varrer de minuto em minuto só custaria consulta. Uma
 * hora de atraso no cancelamento é invisível para quem pediu para sair.
 *
 * A primeira volta sai 60s depois do boot, e não na hora: no boot o pool ainda
 * está subindo e as migrations acabaram de rodar.
 */
function startSweeper() {
  const tick = async () => {
    try {
      const r = await runDue({ limit: 50 });
      if (r && r.canceled) log.info("sweeper.tick", r);
    } catch (err) {
      log.error("sweeper.error", { message: err && err.message });
    }
  };
  setTimeout(tick, 60 * 1000);
  setInterval(tick, ONE_HOUR);
}

module.exports = {
  cancelAtPeriodEnd,
  releaseSchedule,
  runDue,
  startSweeper,
};
