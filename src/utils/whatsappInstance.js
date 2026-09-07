// src/utils/whatsappInstance.js
// O nome da instância de uma pessoa na Evolution (mig 223).
//
// ⚠️ NUNCA é digitado. Ele vai dentro da URL da Evolution e é a CHAVE DE
// ROTEAMENTO do webhook — quem manda o evento diz só o nome da instância, e é
// por ele que se descobre de quem é a conversa. Deixar a pessoa escolher
// abriria a porta para duas instâncias com o mesmo nome disputando a mesma
// caixa de entrada.
//
// Derivado do `id_user` (UUID sem hífens), com prefixo: o UUID começa com
// dígito em metade dos casos, e prefixo fixo mantém o nome legível no painel da
// Evolution ("de quem é esta sessão?") sem consultar o banco.

const PREFIX = "fl-u-";

/** Alfabeto aceito pela Evolution no nome de instância. */
const SAFE = /^[a-zA-Z0-9_-]+$/;

/** O nome da instância deste usuário. Determinístico: mesma pessoa, mesmo nome. */
function instanceNameFor(id_user) {
  const raw = String(id_user || "").replace(/-/g, "").toLowerCase();
  if (!raw) throw new Error("instanceNameFor: id_user ausente");
  return `${PREFIX}${raw}`;
}

/**
 * Recusa nome fora do alfabeto ANTES de ele virar caminho de URL na Evolution.
 * O nome sai daqui de dentro, mas ele também CHEGA de fora (o webhook diz de
 * qual instância veio o evento) — e o que chega de fora nunca é confiável.
 */
function assertInstanceName(name) {
  const clean = String(name || "").trim();
  if (!clean || clean.length > 64 || !SAFE.test(clean)) {
    const err = new Error("Nome de instância inválido.");
    err.statusCode = 400;
    throw err;
  }
  return clean;
}

module.exports = { instanceNameFor, assertInstanceName, PREFIX };
