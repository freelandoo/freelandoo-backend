// Configuração compartilhada da integração Melhor Envio (sandbox × produção).
//
// MELHOR_ENVIO_ENV=production liga a API real (melhorenvio.com.br); qualquer
// outro valor (ou ausente) usa o sandbox — default seguro pra dev/local.
// Token: em produção exige MELHOR_ENVIO_TOKEN; em sandbox aceita
// MELHOR_ENVIO_SANDBOX_TOKEN (legado) ou MELHOR_ENVIO_TOKEN.

const PRODUCTION_BASE = "https://melhorenvio.com.br/api/v2";
const SANDBOX_BASE = "https://sandbox.melhorenvio.com.br/api/v2";

const IS_PRODUCTION =
  String(process.env.MELHOR_ENVIO_ENV || "").toLowerCase() === "production";

const BASE_URL = IS_PRODUCTION ? PRODUCTION_BASE : SANDBOX_BASE;

function authHeaders() {
  const token = IS_PRODUCTION
    ? process.env.MELHOR_ENVIO_TOKEN
    : process.env.MELHOR_ENVIO_SANDBOX_TOKEN || process.env.MELHOR_ENVIO_TOKEN;
  if (!token) {
    throw new Error(
      IS_PRODUCTION
        ? "MELHOR_ENVIO_TOKEN não configurado (produção)"
        : "MELHOR_ENVIO_SANDBOX_TOKEN não configurado"
    );
  }
  const contact = process.env.MELHOR_ENVIO_CONTACT_EMAIL || "alex.rodriguus@gmail.com";
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": `Freelandoo (${contact})`,
  };
}

module.exports = { BASE_URL, IS_PRODUCTION, authHeaders };
