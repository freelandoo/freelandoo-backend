const pool = require("../databases");
const ProductRequestStorage = require("../storages/ProductRequestStorage");
const ProductRequestResponseStorage = require("../storages/ProductRequestResponseStorage");
const ProfileProductStorage = require("../storages/ProfileProductStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const NotificationStorage = require("../storages/NotificationStorage");
const { isProfilePaid } = require("./ProfileProductService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProductRequestResponseService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
