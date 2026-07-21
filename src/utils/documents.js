// Validação de CPF/CNPJ com dígitos verificadores.
// O Melhor Envio em produção recusa documentos com dígito inválido, então a
// validação aqui precisa bater com a deles (não basta contar dígitos).

function onlyDigits(s) {
  if (s == null) return "";
  return String(s).replace(/\D/g, "");
}

function isValidCPF(value) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // todos iguais (000..., 111...)

  const calcDigit = (sliceLen) => {
    let sum = 0;
    for (let i = 0; i < sliceLen; i++) {
      sum += Number(cpf[i]) * (sliceLen + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return calcDigit(9) === Number(cpf[9]) && calcDigit(10) === Number(cpf[10]);
}

function isValidCNPJ(value) {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calcDigit = (sliceLen) => {
    const weights = sliceLen === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < sliceLen; i++) {
      sum += Number(cnpj[i]) * weights[i];
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return calcDigit(12) === Number(cnpj[12]) && calcDigit(13) === Number(cnpj[13]);
}

// Aceita CPF (11) ou CNPJ (14). Retorna os dígitos limpos se válido, senão null.
function normalizeDocument(value) {
  const digits = onlyDigits(value);
  if (digits.length === 11 && isValidCPF(digits)) return digits;
  if (digits.length === 14 && isValidCNPJ(digits)) return digits;
  return null;
}

// Só CPF: retorna os 11 dígitos se o documento for válido, senão null.
// Usado no cadastro/onboarding (tb_user.cpf, mig 188) — CNPJ não serve ali,
// porque a conta é sempre de uma pessoa física titular.
function normalizeCPF(value) {
  const digits = onlyDigits(value);
  return digits.length === 11 && isValidCPF(digits) ? digits : null;
}

// Máscara para exibição ao próprio dono: 123.***.**9-01.
// Nunca devolver o CPF inteiro em API — minimização (LGPD).
function maskCPF(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return null;
  return `${digits.slice(0, 3)}.***.**${digits.slice(8, 9)}-${digits.slice(9)}`;
}

module.exports = {
  onlyDigits,
  isValidCPF,
  isValidCNPJ,
  normalizeDocument,
  normalizeCPF,
  maskCPF,
};
