const ConversationService = require("../services/ConversationService");
const ServiceRequestService = require("../services/ServiceRequestService");
const NotificationService = require("../services/NotificationService");

function safeResult(promise) {
  return promise
    .then((v) => v)
    .catch(() => ({ error: "internal" }));
}

class NavCountsController {
  // GET /me/nav-counts
  // Agrega badge de conversas, service-requests e notificações em uma chamada
  // só, executadas em paralelo dentro do backend (cortando fan-out do proxy
  // Vercel). Se uma falhar, ainda devolve as outras zeradas.
  static async summary(req, res) {
    if (!req.user?.id_user) {
      return res.json({
        conversations: { total: 0, by_actor: [] },
        serviceRequests: { has_new: false, unread_chats: 0 },
        notifications: { unread_count: 0 },
      });
    }

    const [conv, sr, notif] = await Promise.all([
      safeResult(ConversationService.unreadSummary(req.user)),
      safeResult(ServiceRequestService.badgeForUser(req.user)),
      safeResult(NotificationService.unreadCount(req.user)),
    ]);

    const conversations =
      conv && !conv.error
        ? {
            total: Number(conv.total) || 0,
            by_actor: Array.isArray(conv.by_actor) ? conv.by_actor : [],
          }
        : { total: 0, by_actor: [] };

    const serviceRequests =
      sr && !sr.error
        ? {
            has_new: !!sr.has_new,
            unread_chats: Number(sr.unread_chats) || 0,
          }
        : { has_new: false, unread_chats: 0 };

    const notifications =
      notif && !notif.error
        ? { unread_count: Number(notif.unread) || Number(notif.unread_count) || 0 }
        : { unread_count: 0 };

    return res.json({ conversations, serviceRequests, notifications });
  }
}

module.exports = NavCountsController;
