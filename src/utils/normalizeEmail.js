/**
 * Normaliza email para comparação e persistência (trim + minúsculas).
 * Domínio e caixa seguem o uso comum em login (RFC permite nuances no local-part;
 * na prática tratar como case-insensitive evita usuários duplicados).
 */
function normalizeEmail(email) {
  if (email == null || typeof email !== "string") {
    return "";
  }
  return email.trim().toLowerCase();
}

module.exports = normalizeEmail;
