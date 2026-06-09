const pool = require("../databases");
const ProductRequestStorage = require("../storages/ProductRequestStorage");
const ProductRequestResponseStorage = require("../storages/ProductRequestResponseStorage");
const ProfileProductStorage = require("../storages/ProfileProductStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const NotificationStorage = require("../storages/NotificationStorage");
const { isProfilePaid } = require("./ProfileProductService");
const realtime = require("../realtime/socket");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProductRequestResponseService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Mapeia uma linha de chat (buyer/seller) para o shape de O.S. do frontend.
function mapChat(r, side) {
  return {
    id_response: r.id_response,
    response_status: r.response_status,
    response_created_at: r.response_created_at,
    last_message: r.last_message,
    last_message_at: r.last_message_at || r.updated_at || r.response_created_at,
    unread_count: Number(r.unread_count) || 0,
    request: {
      id_request: r.id_product_request,
      status: r.request_status,
      description: r.description,
      estado: r.state,
      municipio: r.city,
      id_machine: 0,
      id_category: 0,
      machine_name: null,
      category_name: r.category_name,
      id_response_chosen: null,
    },
    profile:
      side === "pro"
        ? {
            id_profile: "",
            display_name: r.buyer_username || "Comprador",
            avatar_url: null,
            sub_profile_slug: null,
            username: r.buyer_username || null,
            is_clan: false,
          }
        : {
            id_profile: r.id_profile,
            display_name: r.display_name,
            avatar_url: r.avatar_url,
            sub_profile_slug: r.sub_profile_slug,
            username: r.seller_username || null,
            is_clan: !!r.is_clan,
          },
    productInfo: {
      title: r.title,
      description: r.description,
      city: r.city,
      state: r.state,
      category_name: r.category_name,
      status: r.request_status,
      seller_message: r.seller_message,
      proposed_price_cents: r.proposed_price_cents,
    },
  };
}

class ProductRequestResponseService {
  static async create(user, id_product_request, body) {
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user, id_product_request }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!UUID_RE.test(String(id_product_request || ""))) return { error: "id_product_request inválido" };

      const id_profile = body?.id_profile;
      if (!UUID_RE.test(String(id_profile || ""))) return { error: "id_profile inválido" };

      const message = typeof body?.message === "string" ? body.message.trim() : "";
      if (message.length < 3) return { error: "Mensagem obrigatória (mín. 3 caracteres)" };
      if (message.length > 4000) return { error: "Mensagem excede 4000 caracteres" };

      let proposed_price_cents = null;
      if (body?.proposed_price_cents !== undefined && body?.proposed_price_cents !== null && body?.proposed_price_cents !== "") {
        const n = Number(body.proposed_price_cents);
        if (!Number.isInteger(n) || n < 0) return { error: "Preço proposto inválido" };
        proposed_price_cents = n;
      }

      let id_profile_product = null;
      if (body?.id_profile_product) {
        const idp = Number(body.id_profile_product);
        if (!Number.isInteger(idp) || idp <= 0) return { error: "id_profile_product inválido" };
        id_profile_product = idp;
      }

      const profile = await ProfileStorage.getProfileById(pool, id_profile);
      if (!profile) return { error: "Subperfil não encontrado" };
      if (String(profile.id_user) !== String(user.id_user)) return { error: "Sem permissão para este subperfil" };
      if (profile.is_clan) return { error: "Clans não podem responder pedidos de produto" };

      const paid = await isProfilePaid(pool, id_profile);
      if (!paid) return { error: "Apenas subperfis pagos podem responder a pedidos de produto" };

      const request = await ProductRequestStorage.getById(pool, id_product_request);
      if (!request) return { error: "Pedido não encontrado" };
      if (!["open", "answered", "negotiating"].includes(request.status)) {
        return { error: "Pedido não está aberto" };
      }

      if (id_profile_product) {
        const product = await ProfileProductStorage.getById(pool, id_profile_product);
        if (!product || String(product.id_profile) !== String(id_profile)) {
          return { error: "Produto sugerido não pertence ao seu subperfil" };
        }
        if (!product.is_active) return { error: "Produto sugerido não está ativo" };
        if (product.stock_quantity <= 0) return { error: "Produto sugerido sem estoque" };
        if (Number(product.id_product_category) !== Number(request.id_product_category)) {
          return { error: "Produto sugerido não é da categoria do pedido" };
        }
      }

      const response = await ProductRequestResponseStorage.create(pool, {
        id_product_request,
        id_seller_user: user.id_user,
        id_profile,
        id_profile_product,
        message,
        proposed_price_cents,
      });

      // Marca o pedido como "answered" (transição leve)
      await ProductRequestStorage.markAnswered(pool, id_product_request);

      // Notifica o comprador (fire-and-forget)
      try {
        await NotificationStorage.insert(pool, {
          id_recipient_user: request.id_buyer_user,
          type: "product_response_new",
          id_actor_user: user.id_user,
          id_actor_profile: id_profile,
          entity_type: "product_request",
          entity_id: id_product_request,
          payload: {
            title: request.title,
            seller_display_name: profile.display_name,
          },
        });
      } catch (err) {
        log.warn("notify.buyer.fail", { err: err?.message });
      }

      return { response };
    });
  }

  // Abre (ou reaproveita) a conversa do vendedor com o comprador — SEM exigir
  // mensagem. Chamado pelo "Responder" do Mural; a troca acontece na thread.
  static async openConversation(user, id_product_request, body) {
    return runWithLogs(log, "openConversation", () => ({ id_user: user?.id_user, id_product_request }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!UUID_RE.test(String(id_product_request || ""))) return { error: "id_product_request inválido" };
      const id_profile = body?.id_profile;
      if (!UUID_RE.test(String(id_profile || ""))) return { error: "id_profile inválido" };

      const profile = await ProfileStorage.getProfileById(pool, id_profile);
      if (!profile) return { error: "Subperfil não encontrado" };
      if (String(profile.id_user) !== String(user.id_user)) return { error: "Sem permissão para este subperfil" };
      if (profile.is_clan) return { error: "Clans não podem responder pedidos de produto" };
      const paid = await isProfilePaid(pool, id_profile);
      if (!paid) return { error: "Apenas subperfis pagos podem responder a pedidos de produto" };

      const request = await ProductRequestStorage.getById(pool, id_product_request);
      if (!request) return { error: "Pedido não encontrado" };
      if (!["open", "answered", "negotiating"].includes(request.status)) {
        return { error: "Pedido não está aberto" };
      }

      // Reaproveita se já existe; senão cria conversa vazia (message = '').
      let response = await ProductRequestResponseStorage.getByPair(pool, id_product_request, id_profile);
      if (!response) {
        response = await ProductRequestResponseStorage.create(pool, {
          id_product_request,
          id_seller_user: user.id_user,
          id_profile,
          id_profile_product: null,
          message: "",
          proposed_price_cents: null,
        });
        await ProductRequestStorage.markAnswered(pool, id_product_request);
        try {
          await NotificationStorage.insert(pool, {
            id_recipient_user: request.id_buyer_user,
            type: "product_response_new",
            id_actor_user: user.id_user,
            id_actor_profile: id_profile,
            entity_type: "product_request",
            entity_id: id_product_request,
            payload: { title: request.title, seller_display_name: profile.display_name },
          });
        } catch (err) { log.warn("notify.buyer.fail", { err: err?.message }); }
      }
      return { response };
    });
  }

  // ── Chat (thread) ───────────────────────────────────────────────────────────
  static async sendMessage(user, id_response, body) {
    return runWithLogs(log, "sendMessage", () => ({ id_user: user?.id_user, id_response }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!UUID_RE.test(String(id_response || ""))) return { error: "id_response inválido" };
      const content = typeof body?.content === "string" ? body.content.trim() : "";
      if (content.length < 1) return { error: "Mensagem vazia" };

      const resp = await ProductRequestResponseStorage.getById(pool, id_response);
      if (!resp) return { error: "Resposta não encontrada" };
      const request = await ProductRequestStorage.getById(pool, resp.id_product_request);
      if (!request) return { error: "Pedido não encontrado" };

      let sender;
      if (String(request.id_buyer_user) === String(user.id_user)) {
        sender = "USER";
      } else {
        const profile = await ProfileStorage.getProfileById(pool, resp.id_profile);
        if (!profile || String(profile.id_user) !== String(user.id_user)) return { error: "Sem permissão" };
        sender = "PRO";
      }

      const msg = await ProductRequestResponseStorage.insertMessage(pool, {
        id_response, sender, content: content.slice(0, 4000),
      });

      try {
        const proProfile = await ProfileStorage.getProfileById(pool, resp.id_profile);
        const buyerUserId = request.id_buyer_user;
        const proUserId = proProfile?.id_user;
        const payload = { id_response, kind: "product", sender, message: msg };
        if (buyerUserId) realtime.emitToUser(buyerUserId, "os:message", payload);
        if (proUserId && proUserId !== buyerUserId) realtime.emitToUser(proUserId, "os:message", payload);
        if (buyerUserId) realtime.emitToUser(buyerUserId, "nav-counts:changed", { reason: "os_message", id_response });
        if (proUserId && proUserId !== buyerUserId) realtime.emitToUser(proUserId, "nav-counts:changed", { reason: "os_message", id_response });
      } catch { /* best-effort */ }

      return { message: msg };
    });
  }

  static async listMessages(user, id_response) {
    return runWithLogs(log, "listMessages", () => ({ id_user: user?.id_user, id_response }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!UUID_RE.test(String(id_response || ""))) return { error: "id_response inválido" };
      const resp = await ProductRequestResponseStorage.getById(pool, id_response);
      if (!resp) return { error: "Resposta não encontrada" };
      const request = await ProductRequestStorage.getById(pool, resp.id_product_request);
      if (!request) return { error: "Pedido não encontrado" };

      const isUser = String(request.id_buyer_user) === String(user.id_user);
      let isPro = false;
      if (!isUser) {
        const profile = await ProfileStorage.getProfileById(pool, resp.id_profile);
        isPro = profile && String(profile.id_user) === String(user.id_user);
      }
      if (!isUser && !isPro) return { error: "Sem permissão" };

      const messages = await ProductRequestResponseStorage.listMessages(pool, id_response);
      if (isUser) await ProductRequestResponseStorage.markReadByBuyer(pool, id_response);
      else await ProductRequestResponseStorage.markReadBySeller(pool, id_response);

      return { messages, side: isUser ? "USER" : "PRO", response: { id_response: resp.id_response, status: resp.status } };
    });
  }

  static async markRead(user, id_response) {
    return runWithLogs(log, "markRead", () => ({ id_user: user?.id_user, id_response }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!UUID_RE.test(String(id_response || ""))) return { error: "id_response inválido" };
      const resp = await ProductRequestResponseStorage.getById(pool, id_response);
      if (!resp) return { error: "Resposta não encontrada" };
      const request = await ProductRequestStorage.getById(pool, resp.id_product_request);
      if (!request) return { error: "Pedido não encontrado" };
      if (String(request.id_buyer_user) === String(user.id_user)) {
        await ProductRequestResponseStorage.markReadByBuyer(pool, id_response);
      } else {
        const profile = await ProfileStorage.getProfileById(pool, resp.id_profile);
        if (profile && String(profile.id_user) === String(user.id_user)) {
          await ProductRequestResponseStorage.markReadBySeller(pool, id_response);
        } else return { error: "Sem permissão" };
      }
      return { ok: true };
    });
  }

  static async listMyChats(user) {
    return runWithLogs(log, "listMyChats", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const rows = await ProductRequestResponseStorage.listChatsForBuyer(pool, user.id_user);
      return { chats: rows.map((r) => mapChat(r, "user")) };
    });
  }

  static async listMyProChats(user) {
    return runWithLogs(log, "listMyProChats", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const rows = await ProductRequestResponseStorage.listChatsForSeller(pool, user.id_user);
      return { chats: rows.map((r) => mapChat(r, "pro")) };
    });
  }

  static async listByRequest(user, id_product_request) {
    return runWithLogs(log, "listByRequest", () => ({ id_user: user?.id_user, id_product_request }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!UUID_RE.test(String(id_product_request || ""))) return { error: "id_product_request inválido" };

      const request = await ProductRequestStorage.getById(pool, id_product_request);
      if (!request) return { error: "Pedido não encontrado" };

      // Comprador vê tudo; vendedores veem só a própria resposta.
      const all = await ProductRequestResponseStorage.listByRequest(pool, id_product_request);
      if (String(request.id_buyer_user) === String(user.id_user)) {
        return { responses: all, request };
      }
      const mine = all.filter((r) => String(r.id_seller_user) === String(user.id_user));
      return { responses: mine, request };
    });
  }
}

module.exports = ProductRequestResponseService;
