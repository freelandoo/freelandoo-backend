const pool = require("../databases");
const ProductRequestStorage = require("../storages/ProductRequestStorage");
const ProductRequestResponseStorage = require("../storages/ProductRequestResponseStorage");
const ProductCategoryStorage = require("../storages/ProductCategoryStorage");
const NotificationStorage = require("../storages/NotificationStorage");
const ProductRequestMatchingService = require("./ProductRequestMatchingService");
const StoreProductPolicyService = require("./StoreProductPolicyService");
const uploadProductRequestImage = require("../integrations/r2/uploadProductRequestImage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProductRequestService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validate(payload) {
  const out = {};

  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  if (title.length < 3) return { error: "Título obrigatório (mín. 3 caracteres)" };
  out.title = title.slice(0, 160);

  const description = typeof payload?.description === "string" ? payload.description.trim() : "";
  if (description.length < 5) return { error: "Descrição obrigatória (mín. 5 caracteres)" };
  out.description = description.slice(0, 4000);

  // city/state opcionais — quando ausentes, o pedido é nacional (sem filtro geográfico).
  const city = typeof payload?.city === "string" ? payload.city.trim() : "";
  out.city = city ? city.slice(0, 120) : null;

  const state = typeof payload?.state === "string" ? payload.state.trim().toUpperCase() : "";
  if (state && state.length !== 2) return { error: "Estado inválido (UF de 2 letras)" };
  out.state = state || null;

  const cat = Number(payload?.id_product_category);
  if (!Number.isInteger(cat) || cat <= 0) return { error: "Categoria inválida" };
  out.id_product_category = cat;

  if (payload?.min_price_cents !== undefined && payload?.min_price_cents !== null && payload?.min_price_cents !== "") {
    const n = Number(payload.min_price_cents);
    if (!Number.isInteger(n) || n < 0) return { error: "min_price_cents inválido" };
    out.min_price_cents = n;
  }
  if (payload?.max_price_cents !== undefined && payload?.max_price_cents !== null && payload?.max_price_cents !== "") {
    const n = Number(payload.max_price_cents);
    if (!Number.isInteger(n) || n < 0) return { error: "max_price_cents inválido" };
    out.max_price_cents = n;
  }
  if (out.min_price_cents != null && out.max_price_cents != null && out.min_price_cents > out.max_price_cents) {
    return { error: "Preço mínimo não pode ser maior que o máximo" };
  }

  // Atributos estruturados (mig 142) — espelham os subfiltros da Loja.
  // Formato aceito: { chave: "valor" | ["valor", ...] }; chaves [a-z0-9_],
  // valores string. Tudo opcional; o que não passar é descartado em silêncio.
  out.attributes = {};
  if (payload?.attributes && typeof payload.attributes === "object" && !Array.isArray(payload.attributes)) {
    const KEY_RE = /^[a-z0-9_]{1,40}$/;
    let keys = 0;
    for (const [key, raw] of Object.entries(payload.attributes)) {
      if (!KEY_RE.test(key) || keys >= 16) continue;
      const list = (Array.isArray(raw) ? raw : [raw])
        .filter((v) => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => v.length > 0 && v.length <= 80)
        .slice(0, 20);
      if (list.length === 0) continue;
      out.attributes[key] = list;
      keys += 1;
    }
  }

  return { data: out };
}

class ProductRequestService {
  static async create(user, body, file) {
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };

      const v = validate(body || {});
      if (v.error) return { error: v.error };

      const cat = await ProductCategoryStorage.getById(pool, v.data.id_product_category);
      if (!cat || cat.status !== "active") return { error: "Categoria inválida ou inativa" };

      // Policy: bloqueia pedidos de produtos proibidos antes do upload/insert.
      const policy = await StoreProductPolicyService.checkProductRequest({
        title: v.data.title,
        description: v.data.description,
        id_product_category: v.data.id_product_category,
      });
      if (["block", "ban_product", "ban_category", "hide_product"].includes(policy.action)) {
        return {
          error: policy.reason || "Este pedido não é permitido pela política da plataforma.",
          policy_action: policy.action,
        };
      }

      let reference_image_url = null;
      let reference_image_key = null;
      if (file && file.buffer) {
        const mime = String(file.mimetype || "").toLowerCase();
        if (!mime.startsWith("image/")) return { error: "Imagem de referência deve ser JPG/PNG/WebP" };
        const up = await uploadProductRequestImage({ file });
        reference_image_url = up.url;
        reference_image_key = up.key;
      }

      const request = await ProductRequestStorage.create(pool, {
        id_buyer_user: user.id_user,
        ...v.data,
        reference_image_url,
        reference_image_key,
      });

      // Se policy disse "review", marca para revisão e NÃO notifica vendedores.
      if (policy.action === "review") {
        await pool.query(
          `UPDATE public.tb_product_request
              SET moderation_status = 'pending_review', updated_at = NOW()
            WHERE id_product_request = $1`,
          [request.id_product_request]
        );
        request.moderation_status = "pending_review";
        return { request, pending_review: true };
      }

      // Notifica subperfis elegíveis (fire-and-forget; nunca quebra o create).
      try {
        const eligible = await ProductRequestMatchingService.findEligibleSubprofiles(
          request.id_product_request
        );
        for (const row of eligible) {
          await NotificationStorage.insert(pool, {
            id_recipient_user: row.id_user,
            id_recipient_profile: row.id_profile,
            type: "product_request_new",
            id_actor_user: user.id_user,
            entity_type: "product_request",
            entity_id: request.id_product_request,
            payload: {
              title: request.title,
              category_id: request.id_product_category,
              category_name: cat.name,
              city: request.city,
              state: request.state,
            },
          });
        }
      } catch (err) {
        log.warn("notify.eligible.fail", { err: err?.message });
      }

      return { request };
    });
  }

  static async listMine(user) {
    return runWithLogs(log, "listMine", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      await ProductRequestStorage.expireOld(pool);
      const requests = await ProductRequestStorage.listByBuyer(pool, user.id_user);
      return { requests };
    });
  }

  static async listMySentResponses(user) {
    return runWithLogs(log, "listMySentResponses", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const responses = await ProductRequestResponseStorage.listBySellerUser(pool, user.id_user);
      return { responses };
    });
  }

  static async getById(user, id_product_request) {
    return runWithLogs(log, "getById", () => ({ id_user: user?.id_user, id_product_request }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!UUID_RE.test(String(id_product_request || ""))) return { error: "id_product_request inválido" };
      const r = await ProductRequestStorage.getById(pool, id_product_request);
      if (!r) return { error: "Pedido não encontrado" };
      // Comprador sempre vê. Vendedor: vê se já respondeu (ownership de subperfil).
      if (String(r.id_buyer_user) === String(user.id_user)) return { request: r };
      const { rows } = await pool.query(
        `SELECT 1 FROM public.tb_product_request_response prr
           JOIN public.tb_profile p ON p.id_profile = prr.id_profile
          WHERE prr.id_product_request = $1 AND p.id_user = $2
          LIMIT 1`,
        [id_product_request, user.id_user]
      );
      if (rows.length > 0) return { request: r };
      return { error: "Sem permissão" };
    });
  }

  static async cancel(user, id_product_request) {
    return runWithLogs(log, "cancel", () => ({ id_user: user?.id_user, id_product_request }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!UUID_RE.test(String(id_product_request || ""))) return { error: "id_product_request inválido" };
      const r = await ProductRequestStorage.getById(pool, id_product_request);
      if (!r) return { error: "Pedido não encontrado" };
      if (String(r.id_buyer_user) !== String(user.id_user)) return { error: "Sem permissão" };
      if (!["open", "answered", "negotiating"].includes(r.status)) {
        return { error: "Pedido não pode ser cancelado neste estado" };
      }
      const updated = await ProductRequestStorage.cancel(pool, id_product_request);
      return { request: updated };
    });
  }

  static async hide(user, id_product_request) {
    return runWithLogs(log, "hide", () => ({ id_user: user?.id_user, id_product_request }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!UUID_RE.test(String(id_product_request || ""))) return { error: "id_product_request inválido" };
      const r = await ProductRequestStorage.getById(pool, id_product_request);
      if (!r) return { error: "Pedido não encontrado" };
      if (String(r.id_buyer_user) !== String(user.id_user)) return { error: "Sem permissão" };
      await ProductRequestStorage.hideForBuyer(pool, {
        id_product_request,
        id_buyer_user: user.id_user,
      });
      return { hidden: true };
    });
  }

  static async close(user, id_product_request) {
    return runWithLogs(log, "close", () => ({ id_user: user?.id_user, id_product_request }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!UUID_RE.test(String(id_product_request || ""))) return { error: "id_product_request inválido" };
      const r = await ProductRequestStorage.getById(pool, id_product_request);
      if (!r) return { error: "Pedido não encontrado" };
      if (String(r.id_buyer_user) !== String(user.id_user)) return { error: "Sem permissão" };
      if (!["open", "answered", "negotiating"].includes(r.status)) {
        return { error: "Pedido não pode ser fechado neste estado" };
      }
      const updated = await ProductRequestStorage.close(pool, id_product_request);
      return { request: updated };
    });
  }
}

module.exports = ProductRequestService;
