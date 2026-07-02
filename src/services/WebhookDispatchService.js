// src/services/WebhookDispatchService.js
// Entrega de webhooks da API de Atendimento. Evento v1: message.received.
// Enfileira em tb_api_webhook_delivery, tenta na hora e re-tenta com backoff
// via sweeper (60s). Assinatura: X-Freelandoo-Signature = sha256=HMAC(secret,
// `${timestamp}.${body}`) — timestamp junto evita replay (amenda o spec, que
// dizia HMAC só do body).
const crypto = require("crypto");
const pool = require("../databases");
const ApiConnectionStorage = require("../storages/ApiConnectionStorage");
const ExtMessagingStorage = require("../storages/ExtMessagingStorage");
const { createLogger } = require("../utils/logger");

const log = createLogger("WebhookDispatchService");

const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000];
const MAX_ATTEMPTS = BACKOFF_MS.length; // 5
const DELIVER_TIMEOUT_MS = 10_000;

function sign(secret, timestamp, body) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

async function postWebhook({ url, secret, payload }) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Freelandoo-Timestamp": timestamp,
      "X-Freelandoo-Signature": `sha256=${sign(secret, timestamp, body)}`,
      "User-Agent": "Freelandoo-Webhook/1.0",
    },
    body,
    signal: AbortSignal.timeout(DELIVER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function attemptDelivery(delivery, { webhook_url, webhook_secret }) {
  try {
    await postWebhook({ url: webhook_url, secret: webhook_secret, payload: delivery.payload });
    await ApiConnectionStorage.markDelivered(pool, delivery.id_delivery);
  } catch (err) {
    const attempts = (delivery.attempts || 0) + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    const next = new Date(Date.now() + (BACKOFF_MS[attempts - 1] || BACKOFF_MS.at(-1)));
    await ApiConnectionStorage.scheduleRetry(pool, {
      id_delivery: delivery.id_delivery,
      attempts,
      next_attempt_at: next,
      last_error: err?.message,
      failed,
    }).catch(() => {});
    if (failed) log.warn("delivery.failed", { id_delivery: delivery.id_delivery, attempts });
  }
}

async function enqueueForConnections(connections, payloadBuilder) {
  for (const c of connections) {
    try {
      const payload = payloadBuilder(c);
      const delivery = await ApiConnectionStorage.enqueueDelivery(pool, {
        id_connection: c.id_connection,
        event_type: "message.received",
        payload,
      });
      if (delivery) {
        // Entrega imediata fora do request path.
        setImmediate(() => {
          attemptDelivery(delivery, c).catch(() => {});
        });
      }
    } catch (err) {
      log.error("enqueue_error", { id_connection: c.id_connection, message: err?.message });
    }
  }
}

async function listActiveConnectionsWithWebhook(id_user) {
  const { rows } = await pool.query(
    `SELECT id_connection, id_user, scope_personal, webhook_url, webhook_secret, created_at
       FROM public.tb_api_connection
      WHERE id_user = $1 AND status = 'active' AND webhook_url IS NOT NULL`,
    [id_user]
  );
  return rows;
}

class WebhookDispatchService {
  /**
   * Mensagem direta (tb_message) recebida: dispara para as conexões do DONO
   * do lado receptor cujo escopo cobre a conversa. Chamado fire-and-forget
   * pelo ConversationService.sendMessage — nunca lança pro caller.
   */
  static async onDirectMessage({ conversation, message, senderProfileId, recipientProfile, recipientUserId }) {
    if ((conversation.kind || "direct") !== "direct") return;
    if (recipientProfile?.is_clan || recipientProfile?.is_community) return;
    const connections = await listActiveConnectionsWithWebhook(recipientUserId);
    const inScope = connections.filter(
      (c) => c.scope_personal || new Date(conversation.created_at) >= new Date(c.created_at)
    );
    if (!inScope.length) return;
    const sender = await ExtMessagingStorage.getProfileBrief(pool, senderProfileId).catch(() => null);
    await enqueueForConnections(inScope, () => ({
      event: "message.received",
      created_at: new Date().toISOString(),
      conversation: {
        id: `dm:${conversation.id_conversation}`,
        type: "dm",
        created_at: conversation.created_at,
      },
      message: {
        id_message: message.id_message,
        body: message.body,
        kind: message.kind || "text",
        audio_url: message.audio_url || null,
        created_at: message.created_at,
        sender: sender
          ? { id_profile: sender.id_profile, display_name: sender.display_name, username: sender.username }
          : { id_profile: senderProfileId },
      },
    }));
  }

  /**
   * Mensagem de O.S. (tb_service_request_message) enviada pelo COMPRADOR:
   * dispara para as conexões do dono do lado PRO (O.S. sempre no escopo).
   */
  static async onOsMessage({ id_response, request, response, message, recipientUserId }) {
    const connections = await listActiveConnectionsWithWebhook(recipientUserId);
    if (!connections.length) return;
    await enqueueForConnections(connections, () => ({
      event: "message.received",
      created_at: new Date().toISOString(),
      conversation: {
        id: `os:${id_response}`,
        type: "os",
        status: response?.status,
        request: {
          id_request: request?.id_request,
          description: request?.description,
          estado: request?.estado,
          municipio: request?.municipio,
        },
      },
      message: {
        id_message: message.id_message,
        body: message.content,
        kind: "text",
        created_at: message.created_at,
        sender: { side: "USER" },
      },
    }));
  }

  /** Sweeper de retry — chamar UMA vez no boot (index.js). */
  static startSweeper() {
    const tick = async () => {
      try {
        const due = await ApiConnectionStorage.listDueDeliveries(pool, 20);
        for (const d of due) {
          if (d.connection_status !== "active" || !d.webhook_url) {
            await ApiConnectionStorage.scheduleRetry(pool, {
              id_delivery: d.id_delivery,
              attempts: d.attempts,
              next_attempt_at: new Date(),
              last_error: "conexão revogada ou sem webhook",
              failed: true,
            });
            continue;
          }
          await attemptDelivery(d, d);
        }
      } catch (err) {
        log.error("sweeper_error", { message: err?.message });
      }
    };
    setTimeout(tick, 30 * 1000).unref?.();
    setInterval(tick, 60 * 1000).unref?.();
    log.info("sweeper.scheduled", { interval_s: 60 });
  }
}

module.exports = WebhookDispatchService;
