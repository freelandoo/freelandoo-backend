function normalizeName(name = "") {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
}

function generateCouponCode(user) {
  const namePart = normalizeName(user.nome).slice(0, 3).padEnd(3, "X");

  const idPart = String(user.id_user)
    .replace(/-/g, "")
    .toUpperCase()
    .slice(0, 4);

  return `${namePart}-${idPart}`;
}

const MANUAL_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I para legibilidade

function generateManualCouponCode() {
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += MANUAL_CHARS[Math.floor(Math.random() * MANUAL_CHARS.length)];
  }
  return `FREE-${suffix}`;
}

module.exports = {
  generateCouponCode,
  generateManualCouponCode,
};
