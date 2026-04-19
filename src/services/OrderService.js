const pool = require("../databases");
const OrderStorage = require("../storages/OrderStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("OrderService");

class OrderService {
  /**
   * 📌 Busca uma order pelo ID
   *
   * Retorna o resumo completo:
   * - order
   * - items
   * - coupon
   */
  static async getOrderById(user, params) {
    return runWithLogs(
      log,
      "getOrderById",
      () => ({ id_user: user.id_user, id_order: params?.id_order }),
      async () => {
        const { id_order } = params || {};

        if (!id_order) {
          return { error: "id_order é obrigatório" };
        }

        const summary = await OrderStorage.getOrderSummary(pool, id_order);

        if (!summary) {
          return { error: "Order não encontrada" };
        }

        if (summary.id_user !== user.id_user) {
          return { error: "Você não tem permissão para acessar esta order" };
        }

        return { order: summary };
      }
    );
  }

  /**
   * 📌 Lista as orders do usuário logado
   *
   * Filtros opcionais:
   * - status
   */
  static async listMyOrders(user, query) {
    return runWithLogs(
      log,
      "listMyOrders",
      () => ({ id_user: user.id_user, status: query?.status }),
      async () => {
        const { status } = query || {};

        const orders = await OrderStorage.listOrdersByUser(pool, {
          id_user: user.id_user,
          status,
        });

        return { orders };
      }
    );
  }

  /**
   * 📌 Cancela uma order
   *
   * Regras:
   * - a order precisa existir
   * - a order precisa pertencer ao usuário
   * - somente orders pendentes podem ser canceladas
   */
  static async cancelOrder(user, params) {
    return runWithLogs(
      log,
      "cancelOrder",
      () => ({ id_user: user.id_user, id_order: params?.id_order }),
      async () => {
        const { id_order } = params || {};

        if (!id_order) {
          return { error: "id_order é obrigatório" };
        }

        const order = await OrderStorage.getOrderById(pool, id_order);

        if (!order) {
          return { error: "Order não encontrada" };
        }

        if (order.id_user !== user.id_user) {
          return { error: "Você não tem permissão para cancelar esta order" };
        }

        if (order.status !== "PENDING_PAYMENT") {
          return {
            error: "Somente orders pendentes de pagamento podem ser canceladas",
          };
        }

        const updatedOrder = await OrderStorage.cancelOrder(pool, id_order);

        return { order: updatedOrder };
      }
    );
  }
}

module.exports = OrderService;
