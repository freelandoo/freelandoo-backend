const { createLogger } = require("../../utils/logger");
const { lookupZipcode } = require("../viacep/lookup");
const { BASE_URL, IS_PRODUCTION, authHeaders } = require("./config");

const log = createLogger("melhorenvio.purchase");

function clampDim(value, fallback = 2) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(2, Math.round(n));
}

function onlyDigits(s) {
  if (s == null) return "";
  return String(s).replace(/\D/g, "");
}

function sanitize(s, max = 120) {
  if (s == null) return "";
  return String(s).trim().slice(0, max);
}

async function meFetch(path, init = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { ...init, headers: { ...authHeaders(), ...(init.headers || {}) } });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    log.warn("me.http_error", { path, status: res.status, body: typeof data === "string" ? data.slice(0, 400) : JSON.stringify(data).slice(0, 400) });
    const message = typeof data === "object" && data && (data.message || data.error)
      ? (data.message || data.error)
      : `Melhor Envio retornou ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

/**
 * Executa o pipeline completo da etiqueta no Melhor Envio.
 *
 * @param {Object} ctx
 * @param {Object} ctx.order — linha de tb_profile_product_order (já paga)
 * @param {Object} ctx.product — produto (dimensões, peso, preço)
 * @param {Object} ctx.seller — { nome, email, telefone, origin_zipcode, origin_document?, origin_number?, origin_complement? }
 * @returns {Promise<{ melhor_envio_order_id, label_pdf_url, tracking_code? }>}
 */
async function purchaseLabel(ctx) {
  const { order, product, seller } = ctx;

  const originCep = onlyDigits(seller.origin_zipcode);
  const destCep = onlyDigits(order.destination_zipcode);
  if (originCep.length !== 8) throw new Error("CEP de origem inválido");
  if (destCep.length !== 8) throw new Error("CEP de destino inválido");

  const dest = order.destination_full_address || {};
  let originAddr = null;
  try {
    originAddr = await lookupZipcode(originCep);
  } catch (err) {
    log.warn("origin.viacep_fail", { message: err.message });
  }
  if (!originAddr) {
    throw new Error("Não foi possível resolver endereço de origem via ViaCEP");
  }

  const fromName = sanitize(seller.nome, 80) || "Freelandoo Vendedor";
  // Em produção o Melhor Envio valida CPF/CNPJ (dígitos verificadores) — o
  // placeholder do sandbox seria recusado. Falha cedo com mensagem clara,
  // que fica gravada em markLabelFailure e visível no admin.
  let fromDoc = onlyDigits(seller.origin_document);
  if (IS_PRODUCTION) {
    if (fromDoc.length !== 11 && fromDoc.length !== 14) {
      throw new Error("Vendedor sem CPF/CNPJ válido cadastrado — obrigatório para emitir etiqueta em produção");
    }
  } else {
    fromDoc = fromDoc || "00000000000"; // sandbox placeholder
  }
  const fromPhone = onlyDigits(seller.telefone) || "11999999999";

  const from = {
    name: fromName,
    phone: fromPhone,
    email: sanitize(seller.email, 120) || "no-reply@freelandoo.com.br",
    document: fromDoc,
    address: sanitize(originAddr.logradouro, 160) || "Endereço",
    complement: sanitize(seller.origin_complement, 60) || "",
    number: sanitize(seller.origin_number, 20) || "S/N",
    district: sanitize(originAddr.bairro, 60) || "Centro",
    city: sanitize(originAddr.localidade, 60) || "São Paulo",
    country_id: "BR",
    postal_code: originCep,
    state_abbr: sanitize(originAddr.uf, 2) || "SP",
  };

  let toDoc = onlyDigits(order.buyer_document);
  if (IS_PRODUCTION) {
    if (toDoc.length !== 11 && toDoc.length !== 14) {
      throw new Error("Pedido sem CPF do comprador — o checkout precisa coletar CPF antes de emitir etiqueta em produção");
    }
  } else {
    toDoc = toDoc || "00000000000"; // sandbox placeholder; buyer CPF não é coletado hoje
  }

  const to = {
    name: sanitize(order.buyer_name, 80) || "Comprador",
    phone: onlyDigits(order.buyer_whatsapp) || "11999999999",
    email: sanitize(order.buyer_email, 120) || "buyer@example.com",
    document: toDoc,
    address: sanitize(dest.street, 160) || "Endereço",
    complement: sanitize(dest.complement, 60) || "",
    number: sanitize(dest.number, 20) || "S/N",
    district: sanitize(dest.neighborhood, 60) || "Centro",
    city: sanitize(dest.city, 60) || "São Paulo",
    country_id: "BR",
    postal_code: destCep,
    state_abbr: sanitize(dest.uf, 2) || "SP",
  };

  const insurance_value = ((Number(order.unit_price_cents) || 0) / 100) * (Number(order.quantity) || 1);

  const cartBody = {
    service: Number(order.shipping_service_id),
    agency: null,
    from,
    to,
    products: [
      {
        name: sanitize(product.name, 100) || "Produto",
        quantity: Number(order.quantity) || 1,
        unitary_value: (Number(order.unit_price_cents) || 0) / 100,
      },
    ],
    volumes: [
      {
        height: clampDim(product.height_cm),
        width: clampDim(product.width_cm),
        length: clampDim(product.length_cm),
        weight: Math.max(0.1, Number(product.weight_grams || 0) / 1000),
      },
    ],
    options: {
      insurance_value,
      receipt: false,
      own_hand: false,
      reverse: false,
      non_commercial: true,
      invoice: null,
      platform: "Freelandoo",
      tags: [{ tag: `freelandoo:order:${order.id_order}`, url: null }],
    },
  };

  // 1) Adiciona ao carrinho
  const cartRes = await meFetch("/me/cart", {
    method: "POST",
    body: JSON.stringify(cartBody),
  });
  const meOrderId = cartRes?.id;
  if (!meOrderId) throw new Error("Melhor Envio não devolveu id do carrinho");

  // 2) Checkout (debita saldo)
  await meFetch("/me/shipment/checkout", {
    method: "POST",
    body: JSON.stringify({ orders: [meOrderId] }),
  });

  // 3) Generate (ativa etiqueta)
  await meFetch("/me/shipment/generate", {
    method: "POST",
    body: JSON.stringify({ orders: [meOrderId] }),
  });

  // 4) Print (devolve URL do PDF)
  const printRes = await meFetch("/me/shipment/print", {
    method: "POST",
    body: JSON.stringify({ mode: "private", orders: [meOrderId] }),
  });

  const label_pdf_url = printRes?.url || null;

  // 5) Tenta pegar o tracking se já estiver disponível
  let tracking_code = null;
  try {
    const tracking = await meFetch("/me/shipment/tracking", {
      method: "POST",
      body: JSON.stringify({ orders: [meOrderId] }),
    });
    const entry = tracking && (tracking[meOrderId] || tracking[String(meOrderId)]);
    tracking_code = entry?.tracking || entry?.melhorenvio_tracking || null;
  } catch (err) {
    log.warn("tracking.fetch_fail", { meOrderId, message: err.message });
  }

  return { melhor_envio_order_id: String(meOrderId), label_pdf_url, tracking_code };
}

module.exports = { purchaseLabel };
