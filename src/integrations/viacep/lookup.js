const { createLogger } = require("../../utils/logger");

const log = createLogger("viacep");

/**
 * Resolve CEP via ViaCEP (https://viacep.com.br). Retorna `{ cep, logradouro,
 * bairro, localidade, uf }` ou `null` quando não encontrado / inválido.
 *
 * Sem auth; serviço público.
 */
async function lookupZipcode(rawCep) {
  if (!rawCep) return null;
  const digits = String(rawCep).replace(/\D/g, "");
  if (digits.length !== 8) return null;

  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      headers: { "User-Agent": "Freelandoo (alex.rodriguus@gmail.com)" },
    });
    if (!res.ok) {
      log.warn("viacep.http_error", { status: res.status, cep: digits });
      return null;
    }
    const json = await res.json();
    if (json?.erro) return null;
    return {
      cep: digits,
      logradouro: json.logradouro || "",
      bairro: json.bairro || "",
      localidade: json.localidade || "",
      uf: json.uf || "",
    };
  } catch (err) {
    log.warn("viacep.fetch_fail", { cep: digits, message: err?.message });
    return null;
  }
}

module.exports = { lookupZipcode };
