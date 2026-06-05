const { createLogger } = require("../../utils/logger");

const log = createLogger("melhorenvio.track");

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

// Normaliza o status cru do ME para o nosso vocabulário reverso.
function normalizeStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("delivered") || s.includes("entregue")) return "delivered_origin";
  if (s.includes("posted") || s.includes("postado") || s.includes("released")) return "posted";
  if (s.includes("transit") || s.includes("transito") || s.includes("trânsito")) return "in_transit";
  return null; // sem mudança reconhecível
}

/**
 * Consulta o rastreio de um envio no Melhor Envio (ida ou reverso).
 * @param {string} meOrderId
 * @returns {Promise<{ status: string|null, normalized: string|null, tracking: string|null }>}
 */
async function trackShipment(meOrderId) {
  const res = await fetch(`${SANDBOX_BASE}/me/shipment/tracking`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ orders: [meOrderId] }),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    log.warn("track.http_error", { meOrderId, status: res.status });
    const err = new Error(`Melhor Envio tracking retornou ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const entry = data && (data[meOrderId] || data[String(meOrderId)]);
  const status = entry?.status || entry?.tracking_status || null;
  return {
    status,
    normalized: normalizeStatus(status),
    tracking: entry?.tracking || entry?.melhorenvio_tracking || null,
  };
}

module.exports = { trackShipment };
