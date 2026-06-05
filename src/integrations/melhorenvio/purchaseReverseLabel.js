const { createLogger } = require("../../utils/logger");
const { lookupZipcode } = require("../viacep/lookup");

const log = createLogger("melhorenvio.reverse");

const SANDBOX_BASE = "https://sandbox.melhorenvio.com.br/api/v2";

function authHeaders() {
  const token = process.env.MELHOR_ENVIO_SANDBOX_TOKEN;
  if (!token) throw new Error("MELHOR_ENVIO_SANDBOX_TOKEN não configurado");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Freelandoo (alex.rodriguus@gmail.com)",
  };
}

function clampDim(value, fallback = 2) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(2, Math.round(n));
}
function onlyDigits(s) { return s == null ? "" : String(s).replace(/\D/g, ""); }
function sanitize(s, max = 120) { return s == null ? "" : String(s).trim().slice(0, max); }

async function meFetch(path, init = {}) {
  const res = await fetch(`${SANDBOX_BASE}${path}`, { ...init, headers: { ...authHeaders(), ...(init.headers || {}) } });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    log.warn("me.http_error", { path, status: res.status, body: typeof data === "string" ? data.slice(0, 400) : JSON.stringify(data).slice(0, 400) });
    const message = typeof data === "object" && data && (data.message || data.error) ? (data.message || data.error) : `Melhor Envio retornou ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Logística reversa: remetente = COMPRADOR (quem está com o produto),
 * destinatário = ORIGEM do lojista. options.reverse = true. Correios only.
 *
 * @param {Object} ctx { order, product, seller }
 * @returns {Promise<{ me_reverse_order_id, reverse_tracking_code, reverse_auth_code, reverse_label_url }>}
 */
async function purchaseReverseLabel(ctx) {
  const { order, product, seller } = ctx;

  const buyerCep = onlyDigits(order.destination_zipcode);
  const sellerCep = onlyDigits(seller.origin_zipcode);
  if (buyerCep.length !== 8) throw new Error("CEP do comprador inválido");
  if (sellerCep.length !== 8) throw new Error("CEP de origem (lojista) inválido");

  const dest = order.destination_full_address
    ? (typeof order.destination_full_address === "string" ? JSON.parse(order.destination_full_address) : order.destination_full_address)
    : {};

  let sellerAddr = null;
  try { sellerAddr = await lookupZipcode(sellerCep); } catch (err) { log.warn("seller.viacep_fail", { message: err.message }); }
  if (!sellerAddr) throw new Error("Não foi possível resolver endereço do lojista via ViaCEP");

  // from = comprador (devolvendo)
  const from = {
    name: sanitize(order.buyer_name, 80) || "Comprador",
    phone: onlyDigits(order.buyer_whatsapp) || "11999999999",
    email: sanitize(order.buyer_email, 120) || "buyer@example.com",
    document: "00000000000",
    address: sanitize(dest.street, 160) || "Endereço",
    complement: sanitize(dest.complement, 60) || "",
    number: sanitize(dest.number, 20) || "S/N",
    district: sanitize(dest.neighborhood, 60) || "Centro",
    city: sanitize(dest.city, 60) || "São Paulo",
    country_id: "BR",
    postal_code: buyerCep,
    state_abbr: sanitize(dest.uf, 2) || "SP",
  };

  // to = origem do lojista
  const to = {
    name: sanitize(seller.nome, 80) || "Freelandoo Vendedor",
    phone: onlyDigits(seller.telefone) || "11999999999",
    email: sanitize(seller.email, 120) || "no-reply@freelandoo.com.br",
    document: onlyDigits(seller.origin_document) || "00000000000",
    address: sanitize(sellerAddr.logradouro, 160) || "Endereço",
    complement: sanitize(seller.origin_complement, 60) || "",
    number: sanitize(seller.origin_number, 20) || "S/N",
    district: sanitize(sellerAddr.bairro, 60) || "Centro",
    city: sanitize(sellerAddr.localidade, 60) || "São Paulo",
    country_id: "BR",
    postal_code: sellerCep,
    state_abbr: sanitize(sellerAddr.uf, 2) || "SP",
  };

  const insurance_value = ((Number(order.unit_price_cents) || 0) / 100) * (Number(order.quantity) || 1);

  const cartBody = {
    service: Number(order.shipping_service_id) || 1, // Correios (reverso só Correios)
    agency: null,
    from,
    to,
    products: [{
      name: sanitize(product.name, 100) || "Produto",
      quantity: Number(order.quantity) || 1,
      unitary_value: (Number(order.unit_price_cents) || 0) / 100,
    }],
    volumes: [{
      height: clampDim(product.height_cm),
      width: clampDim(product.width_cm),
      length: clampDim(product.length_cm),
      weight: Math.max(0.1, Number(product.weight_grams || 0) / 1000),
    }],
    options: {
      insurance_value,
      receipt: false,
      own_hand: false,
      reverse: true, // ← logística reversa
      non_commercial: true,
      invoice: null,
      platform: "Freelandoo",
      tags: [{ tag: `freelandoo:return:${order.id_order}`, url: null }],
    },
  };

  const cartRes = await meFetch("/me/cart", { method: "POST", body: JSON.stringify(cartBody) });
  const meOrderId = cartRes?.id;
  if (!meOrderId) throw new Error("Melhor Envio não devolveu id do carrinho (reverso)");

  await meFetch("/me/shipment/checkout", { method: "POST", body: JSON.stringify({ orders: [meOrderId] }) });
  await meFetch("/me/shipment/generate", { method: "POST", body: JSON.stringify({ orders: [meOrderId] }) });

  let reverse_label_url = null;
  try {
    const printRes = await meFetch("/me/shipment/print", { method: "POST", body: JSON.stringify({ mode: "private", orders: [meOrderId] }) });
    reverse_label_url = printRes?.url || null;
  } catch (err) {
    log.warn("reverse.print_fail", { meOrderId, message: err.message });
  }

  let reverse_tracking_code = null;
  try {
    const tracking = await meFetch("/me/shipment/tracking", { method: "POST", body: JSON.stringify({ orders: [meOrderId] }) });
    const entry = tracking && (tracking[meOrderId] || tracking[String(meOrderId)]);
    reverse_tracking_code = entry?.tracking || entry?.melhorenvio_tracking || null;
  } catch (err) {
    log.warn("reverse.tracking_fail", { meOrderId, message: err.message });
  }

  // No reverso o "código de autorização de postagem" costuma ser o próprio
  // tracking; guardamos o que houver.
  return {
    me_reverse_order_id: String(meOrderId),
    reverse_tracking_code,
    reverse_auth_code: reverse_tracking_code,
    reverse_label_url,
  };
}

module.exports = { purchaseReverseLabel };
