// src/services/WhatsappForwardDispatcher.js
// Entrega o que chegou no WhatsApp oficial de uma academia ao SISTEMA dela
// (mig 307 — o Coliseu). Mesma assinatura da API de Atendimento
// (WebhookDispatchService): X-Freelandoo-Signature = sha256=HMAC(segredo,
// `${timestamp}.${corpo}`), com o timestamp junto para o outro lado recusar
// replay.
//
// ⚠️ A INGESTÃO IMPORTA ESTE MÓDULO, então ele NÃO pode alcançar quem envia
// WhatsApp (whatsappProvider, WhatsappService) — o
// `whatsappIngestIsolation.test.js` confere pelo fecho dos `require`. Daqui sai
// um POST para o sistema da academia, nunca uma mensagem para a Meta.
//
// Entrega na hora (a recepção espera a mensagem aparecer) e, se falhar, o
// sweeper re-tenta com espera crescente. At-least-once: o Coliseu deduplica
// pelo wa_message_id, como já fazia com a reentrega da Evolution.
const crypto = require("crypto");
const pool = require("../databases");
const WhatsappForwardStorage = require("../storages/WhatsappForwardStorage");
const secretBox = require("../utils/secretBox");
const { createLogger } = require("../utils/logger");

const log = createLogger("WhatsappForwardDispatcher");

const BACKOFF_MS = [10_000, 60_000, 300_000, 900_000, 3_600_000, 21_600_000];
const MAX_ATTEMPTS = BACKOFF_MS.length;
const TIMEOUT_MS = 10_000;
const SWEEP_MS = 15_000;

function sign(secret, timestamp, body) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

async function post(url, secret, payload) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Freelandoo-Timestamp": timestamp,
      "X-Freelandoo-Signature": `sha256=${sign(secret, timestamp, body)}`,
      "User-Agent": "Freelandoo-WhatsApp/1.0",
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function attempt(delivery) {
  try {
    const hook = await WhatsappForwardStorage.getWebhook(pool, delivery.id_academy);
    if (!hook) throw new Error("academia sem webhook configurado");
    await post(hook.url, secretBox.open(hook.secret_sealed), delivery.payload);
    await WhatsappForwardStorage.markDelivered(pool, delivery.id_delivery);
  } catch (err) {
    const attempts = (delivery.attempts || 0) + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await WhatsappForwardStorage.scheduleRetry(pool, {
      id_delivery: delivery.id_delivery,
      attempts,
      next_attempt_at: new Date(Date.now() + (BACKOFF_MS[attempts - 1] || BACKOFF_MS.at(-1))),
      last_error: err && err.message,
      failed,
    }).catch(() => {});
    if (failed) log.warn("forward.failed", { id_delivery: delivery.id_delivery, attempts });
  }
}

class WhatsappForwardDispatcher {
  /**
   * Enfileira e tenta entregar já. Nunca lança: a mensagem está gravada, e a
   * falha de repasse não pode derrubar o webhook da Meta (que reentregaria).
   */
  static async forward(id_academy, payload) {
    try {
      const delivery = await WhatsappForwardStorage.enqueue(pool, id_academy, payload);
      void attempt(delivery);
    } catch (err) {
      log.error("forward.enqueue_fail", { message: err && err.message });
    }
  }

  static startSweeper() {
    const tick = async () => {
      try {
        for (const d of await WhatsappForwardStorage.listDue(pool, 50)) await attempt(d);
      } catch (err) {
        log.error("forward.sweep_fail", { message: err && err.message });
      }
    };
    setInterval(tick, SWEEP_MS).unref?.();
  }
}

module.exports = WhatsappForwardDispatcher;
module.exports.sign = sign;
