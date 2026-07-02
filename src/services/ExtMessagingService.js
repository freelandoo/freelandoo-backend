// src/services/ExtMessagingService.js
// Camada externa da API de Atendimento: traduz ids unificados (dm:/os:) e
// delega nos services internos. NUNCA abre conversa (só responde) — decisão
// do spec 2026-07-02.
const pool = require("../databases");
const ExtMessagingStorage = require("../storages/ExtMessagingStorage");
const ApiConnectionStorage = require("../storages/ApiConnectionStorage");
const ConversationService = require("./ConversationService");
const ServiceRequestService = require("./ServiceRequestService");
const { validateWebhookUrl } = require("../utils/webhookUrl");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ExtMessagingService");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseExtId(raw) {
  const [type, id] = String(raw || "").split(":");
  if (!["dm", "os"].includes(type) || !UUID_RE.test(id || "")) return null;
  return { type, id };
}

function ownerUser(connection) {
  return { id_user: connection.id_user };
}

class ExtMessagingService {
  static async me(connection) {
    return runWithLogs(log, "me", () => ({ id_connection: connection?.id_connection }), async () => {
      const user = await ExtMessagingStorage.getUserBasic(pool, connection.id_user);
      return {
        connection: {
          id_connection: connection.id_connection,
          name: connection.name,
          scope_personal: connection.scope_personal,
          webhook_url: connection.webhook_url,
          created_at: connection.created_at,
        },
        user: user ? { id_user: user.id_user, username: user.username } : null,
      };
    });
  }

  static async setWebhook(connection, body) {
    return runWithLogs(log, "setWebhook", () => ({ id_connection: connection?.id_connection }), async () => {
      const url = String(body?.url || "").trim();
      const check = await validateWebhookUrl(url);
      if (check.error) return check;
      const updated = await ApiConnectionStorage.setWebhookUrl(pool, {
        id_connection: connection.id_connection,
        webhook_url: url,
      });
      if (!updated) return { error: "Conexão inativa" };
      return { webhook_url: updated.webhook_url, webhook_secret: updated.webhook_secret };
    });
  }

  static async listConversations(connection, query) {
    return runWithLogs(log, "listConversations", () => ({ id_connection: connection?.id_connection }), async () => {
      const limit = Math.min(Math.max(parseInt(query?.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      let updated_since = null;
      if (query?.updated_since) {
        const d = new Date(query.updated_since);
        if (Number.isNaN(d.getTime())) return { error: "updated_since inválido (use ISO 8601)" };
        updated_since = d.toISOString();
      }
      const [dms, oss] = await Promise.all([
        ExtMessagingStorage.listDmInScope(pool, {
          id_user: connection.id_user,
          scope_personal: connection.scope_personal,
          connected_at: connection.created_at,
          updated_since,
          limit,
        }),
        ExtMessagingStorage.listOsInScope(pool, {
          id_user: connection.id_user,
          updated_since,
          limit,
        }),
      ]);
      const items = [
        ...dms.map((r) => ({
          id: `dm:${r.id_conversation}`,
          type: "dm",
          created_at: r.created_at,
          last_message_at: r.last_message_at,
          last_message_preview: r.last_message_preview,
          my_profile_id: r.my_profile_id,
          counterpart: {
            id_profile: r.other_profile_id,
            display_name: r.other_display_name,
            username: r.other_username,
            sub_profile_slug: r.other_sub_profile_slug,
            avatar_url: r.other_avatar_url,
          },
        })),
        ...oss.map((r) => ({
          id: `os:${r.id_response}`,
          type: "os",
          status: r.status,
          created_at: r.created_at,
          last_message_at: r.last_message_at,
          last_message_preview: r.last_message_preview,
          my_profile_id: r.my_profile_id,
          request: { id_request: r.id_request, description: r.description, estado: r.estado, municipio: r.municipio },
          counterpart: { username: r.buyer_username },
        })),
      ].sort((a, b) => {
        const ta = new Date(a.last_message_at || a.created_at).getTime();
        const tb = new Date(b.last_message_at || b.created_at).getTime();
        return tb - ta;
      });
      return { items: items.slice(0, limit) };
    });
  }

  static async _resolveScoped(connection, rawId) {
    const parsed = parseExtId(rawId);
    if (!parsed) return { error: "id de conversa inválido (use dm:<uuid> ou os:<uuid>)" };
    if (parsed.type === "dm") {
      const row = await ExtMessagingStorage.getDmInScope(pool, {
        id_conversation: parsed.id,
        id_user: connection.id_user,
        scope_personal: connection.scope_personal,
        connected_at: connection.created_at,
      });
      if (!row) return { error: "Conversa fora do escopo desta conexão", statusCode: 403 };
      return { type: "dm", id: parsed.id, my_profile_id: row.my_profile_id };
    }
    const row = await ExtMessagingStorage.getOsInScope(pool, {
      id_response: parsed.id,
      id_user: connection.id_user,
    });
    if (!row) return { error: "Conversa fora do escopo desta conexão", statusCode: 403 };
    return { type: "os", id: parsed.id };
  }

  static async listMessages(connection, rawId, query) {
    return runWithLogs(log, "listMessages", () => ({ id_connection: connection?.id_connection, rawId }), async () => {
      const scoped = await this._resolveScoped(connection, rawId);
      if (scoped.error) return scoped;
      if (scoped.type === "dm") {
        return ConversationService.listMessages(ownerUser(connection), {
          id_conversation: scoped.id,
          actor_id: scoped.my_profile_id,
          actor_type: "profile",
          cursor: query?.cursor,
          limit: query?.limit,
        });
      }
      return ServiceRequestService.listMessages(ownerUser(connection), scoped.id);
    });
  }

  static async sendMessage(connection, rawId, body) {
    return runWithLogs(log, "sendMessage", () => ({ id_connection: connection?.id_connection, rawId }), async () => {
      const text = String(body?.body || body?.content || "").trim();
      if (!text) return { error: "Mensagem não pode ser vazia" };
      const scoped = await this._resolveScoped(connection, rawId);
      if (scoped.error) return scoped;
      if (scoped.type === "dm") {
        return ConversationService.sendMessage(
          ownerUser(connection),
          {
            id_conversation: scoped.id,
            actor_id: scoped.my_profile_id,
            actor_type: "profile",
            body: text,
          },
          { sent_via: "api" }
        );
      }
      return ServiceRequestService.sendMessage(
        ownerUser(connection),
        scoped.id,
        { content: text },
        { sent_via: "api" }
      );
    });
  }

  static async markRead(connection, rawId) {
    return runWithLogs(log, "markRead", () => ({ id_connection: connection?.id_connection, rawId }), async () => {
      const scoped = await this._resolveScoped(connection, rawId);
      if (scoped.error) return scoped;
      if (scoped.type === "dm") {
        return ConversationService.markRead(ownerUser(connection), {
          id_conversation: scoped.id,
          actor_id: scoped.my_profile_id,
          actor_type: "profile",
        });
      }
      return ServiceRequestService.markRead(ownerUser(connection), scoped.id);
    });
  }
}

module.exports = ExtMessagingService;
