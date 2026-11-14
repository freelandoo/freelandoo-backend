// src/utils/safeFetch.js — Segurança A4 (SSRF): `fetch` para URL que veio de USUÁRIO (webhook de
// saída, reencaminhamento de WhatsApp da academia, API da academia).
//
// A URL era validada só no CADASTRO (`validateWebhookUrl`). Na hora do envio, o `fetch` seguia
// redirecionamento — um servidor público respondia 302 para 169.254.169.254 ou para a rede interna
// e o servidor ia junto — e o DNS podia ter mudado desde o cadastro. Aqui, em TODO envio:
//   1. a URL é validada de novo (HTTPS, host resolve hoje para IP público);
//   2. redirecionamento NÃO é seguido (`redirect: "manual"`): 3xx vira erro.
// Resta a janela entre a consulta de DNS e a conexão (rebinding em milissegundos) — aceita.
// ALLOW_INSECURE_WEBHOOK=1 (só dev local) segue liberando http/localhost, como no cadastro.
const { validateWebhookUrl } = require("./webhookUrl");

class UnsafeUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsafeUrlError";
    this.code = "unsafe_url";
  }
}

async function safeFetch(url, opts = {}) {
  const check = await validateWebhookUrl(url);
  if (check.error) throw new UnsafeUrlError(check.error);
  const res = await fetch(url, { ...opts, redirect: "manual" });
  if (res.status >= 300 && res.status < 400) {
    throw new UnsafeUrlError(`Destino respondeu com redirecionamento (${res.status}); não é seguido`);
  }
  return res;
}

module.exports = { safeFetch, UnsafeUrlError };
