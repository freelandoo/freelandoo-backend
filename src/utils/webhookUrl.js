// src/utils/webhookUrl.js
// Validação anti-SSRF da URL de webhook: HTTPS obrigatório e destino não pode
// resolver para IP privado/loopback/link-local. ALLOW_INSECURE_WEBHOOK=1
// libera http/localhost SÓ para dev local (simulador).
const dns = require("dns").promises;
const net = require("net");

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7)); // IPv4-mapped
  return false;
}

async function validateWebhookUrl(raw) {
  const allowInsecure = process.env.ALLOW_INSECURE_WEBHOOK === "1";
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    return { error: "URL de webhook inválida" };
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    return { error: "Webhook precisa ser http(s)" };
  }
  if (url.protocol !== "https:" && !allowInsecure) {
    return { error: "Webhook precisa ser HTTPS" };
  }
  if (allowInsecure) return { ok: true };
  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch {
    return { error: "Host do webhook não resolve" };
  }
  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) {
    return { error: "Webhook não pode apontar para rede privada" };
  }
  return { ok: true };
}

module.exports = { validateWebhookUrl, isPrivateIp };
