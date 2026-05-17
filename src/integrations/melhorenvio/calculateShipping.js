const { createLogger } = require("../../utils/logger");

const log = createLogger("melhorenvio");

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

/**
 * Calcula opções de frete via Melhor Envio sandbox.
 * @param {Object} input
 * @param {string} input.origin_zipcode - CEP origem (8 dígitos).
 * @param {string} input.destination_zipcode - CEP destino (8 dígitos).
 * @param {Object} input.product - { price_amount (centavos), weight_grams,
 *   height_cm, width_cm, length_cm, quantity? }
 * @returns {Promise<Array<{ service_id, service_name, carrier, price_cents,
 *   delivery_days_min, delivery_days_max }>>}
 */
async function calculateShipping({ origin_zipcode, destination_zipcode, product }) {
  if (!origin_zipcode || !destination_zipcode) {
    throw new Error("CEPs de origem e destino são obrigatórios");
  }

  const quantity = Math.max(1, Number(product.quantity) || 1);

  const body = {
    from: { postal_code: String(origin_zipcode).replace(/\D/g, "") },
    to: { postal_code: String(destination_zipcode).replace(/\D/g, "") },
    products: [
      {
        id: String(product.id_profile_product || "item"),
        width: clampDim(product.width_cm),
        height: clampDim(product.height_cm),
        length: clampDim(product.length_cm),
        weight: Math.max(0.1, Number(product.weight_grams || 0) / 1000),
        insurance_value: ((Number(product.price_amount) || 0) / 100) * quantity,
        quantity,
      },
    ],
  };

  const res = await fetch(`${SANDBOX_BASE}/me/shipment/calculate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log.warn("calc.http_error", { status: res.status, text: text.slice(0, 400) });
    throw new Error(`Melhor Envio retornou ${res.status}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    log.warn("calc.bad_payload", { payload: typeof data });
    return [];
  }

  return data
    .filter((q) => !q.error && q.price != null)
    .map((q) => ({
      service_id: q.id,
      service_name: q.name,
      carrier: q.company?.name || "",
      carrier_picture: q.company?.picture || null,
      price_cents: Math.round(parseFloat(q.price) * 100),
      delivery_days_min: Number(q.delivery_range?.min) || null,
      delivery_days_max: Number(q.delivery_range?.max) || null,
    }))
    .sort((a, b) => a.price_cents - b.price_cents);
}

module.exports = { calculateShipping };
