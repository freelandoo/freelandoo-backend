// src/utils/academyUsername.js
// Username da conta criada pela academia (mig 296): `nome.sobrenome` em ASCII
// minúsculo — primeiro e último nome — e número no fim se já estiver em uso.
// Precisa casar com chk_tb_user_username_format: ^[a-z0-9][a-z0-9_.]{2,29}$.
const MAX_LEN = 30;

function asciiWord(w) {
  return String(w || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Base sem número: "Maria José da Silva" → "maria.silva". */
function usernameBaseFromName(nome) {
  const words = String(nome || "")
    .trim()
    .split(/\s+/)
    .map(asciiWord)
    .filter(Boolean);
  let base;
  if (words.length === 0) base = "aluno";
  else if (words.length === 1) base = words[0];
  else base = `${words[0]}.${words[words.length - 1]}`;
  base = base.slice(0, MAX_LEN - 4).replace(/[._]+$/, "");
  if (base.length < 3) base = `${base || "aluno"}.fit`.slice(0, MAX_LEN - 4);
  return base;
}

/** Candidato número `n` (0 = a base pura). */
function usernameCandidate(base, n) {
  if (!n) return base;
  const suffix = String(n);
  return `${base.slice(0, MAX_LEN - suffix.length)}${suffix}`;
}

module.exports = { usernameBaseFromName, usernameCandidate };
