const crypto = require("crypto");

// Charset sem 0/O/1/I/L para evitar confusão visual ao ditar.
const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateParentalCode() {
  const bytes = crypto.randomBytes(8);
  let suffix = "";
  for (let i = 0; i < 8; i++) {
    suffix += CHARS[bytes[i] % CHARS.length];
  }
  return `PAR-${suffix}`;
}

module.exports = { generateParentalCode };
