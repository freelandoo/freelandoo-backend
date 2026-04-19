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

module.exports = {
  generateCouponCode,
};
