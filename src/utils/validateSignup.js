// Validações de cadastro reutilizáveis no front e no back.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmailFormat(email) {
  if (!email || typeof email !== "string") {
    return { ok: false, error: "Email é obrigatório" };
  }
  if (!EMAIL_RE.test(email.trim())) {
    return { ok: false, error: "Digite um email válido." };
  }
  return { ok: true };
}

function calculateAge(birthDate) {
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

function validateAge18(birthDate) {
  const age = calculateAge(birthDate);
  if (age == null) {
    return { ok: false, error: "Data de nascimento inválida." };
  }
  if (age < 18) {
    return {
      ok: false,
      error: "Você precisa ter 18 anos ou mais para criar uma conta na Freelandoo.",
    };
  }
  return { ok: true };
}

function validatePasswordStrength(password) {
  if (!password || typeof password !== "string") {
    return { ok: false, error: "Senha é obrigatória" };
  }
  if (password.length < 8) {
    return { ok: false, error: "A senha precisa ter no mínimo 8 caracteres." };
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, error: "A senha precisa ter pelo menos 1 letra maiúscula." };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, error: "A senha precisa ter pelo menos 1 número." };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { ok: false, error: "A senha precisa ter pelo menos 1 caractere especial." };
  }
  return { ok: true };
}

module.exports = {
  validateEmailFormat,
  validateAge18,
  validatePasswordStrength,
  calculateAge,
};
