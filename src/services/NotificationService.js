const pool = require("../databases");
const NotificationStorage = require("../storages/NotificationStorage");
const realtime = require("../realtime/socket");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("NotificationService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mapRow(row) {
  if (!row) return null;
  return {
    id_notification: row.id_notification,
    type: row.type,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    id_recipient_profile: row.id_recipient_profile,
    read_at: row.read_at,
    created_at: row.created_at,
    payload: row.payload || {},
    actor: row.id_actor_user
      ? {
          id_user: row.id_actor_user,
          username: row.actor_username,
          id_profile: row.id_actor_profile,
          profile_display_name: row.actor_profile_display_name,
          profile_avatar_url: row.actor_profile_avatar_url,
        }
      : null,
  };
}

/**
 * Cria notificacao fire-and-forget. Erros sao logados e engolidos para nao
 * derrubar a transacao principal que causou a notificacao.
 */
async function safeNotify(data) {
  try {
    if (!data?.id_recipient_user) return null;
    if (
      data.id_actor_user &&
      String(data.id_actor_user) === String(data.id_recipient_user)
    ) {
      // não notifica o próprio ator
      return null;
    }
    const row = await NotificationStorage.insert(pool, data);
    if (row) {
      try {
        realtime.emitToUser(data.id_recipient_user, "notification:new", {
          type: data.type,
          id_notification: row.id_notification,
        });
        realtime.emitToUser(data.id_recipient_user, "nav-counts:changed", {
          reason: "notification_new",
        });
      } catch {
        /* realtime é best-effort */
      }
    }
    return row;
  } catch (err) {
    log.warn("notify.failed", { type: data?.type, error: err?.message });
    return null;
  }
}

class NotificationService {
  static async list(user, query = {}) {
    return runWithLogs(
      log,
      "list",
      () => ({ id_user: user?.id_user, cursor: query?.cursor }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const result = await NotificationStorage.listForUser(pool, {
          id_recipient_user: user.id_user,
          cursor: query?.cursor,
          limit: query?.limit,
        });
        const unread = await NotificationStorage.countUnread(
          pool,
          user.id_user
        );
        return {
          items: result.items.map(mapRow),
          next_cursor: result.next_cursor,
          has_more: result.has_more,
          unread_count: unread,
        };
      }
    );
  }

  static async unreadCount(user) {
    return runWithLogs(
      log,
      "unreadCount",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const unread = await NotificationStorage.countUnread(
          pool,
          user.id_user
        );
        return { unread_count: unread };
      }
    );
  }

  static async markAllRead(user) {
    return runWithLogs(
      log,
      "markAllRead",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const updated = await NotificationStorage.markAllRead(
          pool,
          user.id_user
        );
        return { updated };
      }
    );
  }

  static async markOneRead(user, params) {
    return runWithLogs(
      log,
      "markOneRead",
      () => ({ id_user: user?.id_user, id_notification: params?.id_notification }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_notification = params?.id_notification;
        if (!id_notification || !UUID_RE.test(id_notification)) {
          return { error: "id_notification inválido" };
        }
        const updated = await NotificationStorage.markOneRead(pool, {
          id_notification,
          id_recipient_user: user.id_user,
        });
        if (!updated) return { error: "Notificação não encontrada" };
        return { notification: mapRow(updated) };
      }
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers chamados por outros services (fire-and-forget).
  // ──────────────────────────────────────────────────────────────────────────

  static async notifyFollow({
    actor_user_id,
    actor_profile_id,
    target_profile_id,
  }) {
    if (!target_profile_id) return null;
    const recipient = await NotificationStorage.resolveProfileOwnerUserId(
      pool,
      target_profile_id
    );
    if (!recipient) return null;
    return safeNotify({
      id_recipient_user: recipient,
      id_recipient_profile: target_profile_id,
      type: "follow_received",
      id_actor_user: actor_user_id,
      id_actor_profile: actor_profile_id,
      entity_type: "profile",
      entity_id: target_profile_id,
      payload: {},
    });
  }

  static async notifyLike({
    actor_user_id,
    id_portfolio_item,
    id_profile,
  }) {
    if (!id_profile || !id_portfolio_item) return null;
    const recipient = await NotificationStorage.resolveProfileOwnerUserId(
      pool,
      id_profile
    );
    if (!recipient) return null;
    return safeNotify({
      id_recipient_user: recipient,
      id_recipient_profile: id_profile,
      type: "like_received",
      id_actor_user: actor_user_id,
      entity_type: "portfolio_item",
      entity_id: id_portfolio_item,
      payload: {},
    });
  }

  static async notifyComment({
    actor_user_id,
    id_portfolio_item,
    id_profile,
    content_preview,
  }) {
    if (!id_profile || !id_portfolio_item) return null;
    const recipient = await NotificationStorage.resolveProfileOwnerUserId(
      pool,
      id_profile
    );
    if (!recipient) return null;
    return safeNotify({
      id_recipient_user: recipient,
      id_recipient_profile: id_profile,
      type: "comment_received",
      id_actor_user: actor_user_id,
      entity_type: "portfolio_item",
      entity_id: id_portfolio_item,
      payload: {
        preview: typeof content_preview === "string"
          ? content_preview.slice(0, 140)
          : null,
      },
    });
  }

  static async notifyMessage({
    actor_user_id,
    actor_profile_id,
    recipient_profile_id,
    id_conversation,
    content_preview,
  }) {
    if (!recipient_profile_id || !id_conversation) return null;
    const recipient = await NotificationStorage.resolveProfileOwnerUserId(
      pool,
      recipient_profile_id
    );
    if (!recipient) return null;
    return safeNotify({
      id_recipient_user: recipient,
      id_recipient_profile: recipient_profile_id,
      type: "message_received",
      id_actor_user: actor_user_id,
      id_actor_profile: actor_profile_id,
      entity_type: "conversation",
      entity_id: id_conversation,
      payload: {
        preview: typeof content_preview === "string"
          ? content_preview.slice(0, 140)
          : null,
      },
    });
  }

  /**
   * Notificação de espelho para o responsável quando um menor recebe mensagem.
   * Idempotência: NÃO usa dedupe (cada mensagem vira 1 evento) — o stream para
   * o responsável reflete o tráfego real do menor.
   */
  static async notifySupervisedMessage({
    minor_user_id,
    minor_profile_id,
    responsible_user_id,
    actor_user_id,
    actor_profile_id,
    id_conversation,
    content_preview,
  }) {
    if (!responsible_user_id || !id_conversation) return null;
    return safeNotify({
      id_recipient_user: responsible_user_id,
      id_recipient_profile: null,
      type: "supervised_message_received",
      id_actor_user: actor_user_id,
      id_actor_profile: actor_profile_id,
      entity_type: "conversation",
      entity_id: id_conversation,
      payload: {
        preview: typeof content_preview === "string"
          ? content_preview.slice(0, 140)
          : null,
        minor_user_id,
        minor_profile_id,
      },
    });
  }

  /**
   * Notificação de pedido de permissão: menor pede ao responsável para
   * liberar um toggle (ex.: can_sell_courses).
   * Dedupe parcial em índice (vide mig 062) evita spam.
   */
  static async notifyPermissionRequest({
    minor_user_id,
    responsible_user_id,
    permission_key,
    note,
  }) {
    if (!responsible_user_id || !permission_key) return null;
    return safeNotify({
      id_recipient_user: responsible_user_id,
      id_recipient_profile: null,
      type: "parental_permission_request",
      id_actor_user: minor_user_id,
      id_actor_profile: null,
      entity_type: "minor",
      entity_id: null,
      payload: {
        permission_key,
        note: typeof note === "string" ? note.slice(0, 280) : null,
      },
    });
  }
}

module.exports = NotificationService;
