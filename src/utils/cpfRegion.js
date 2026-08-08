// src/utils/cpfRegion.js
// O 9º dígito do CPF é a REGIÃO FISCAL onde ele foi emitido (não o estado onde
// a pessoa mora hoje). Serve como sinal FRACO de incoerência — alguém que se
// mudou tem divergência legítima, e é comum. Por isso este módulo só responde
// "bate / não bate / não dá pra dizer"; quem decide o peso é o fraudScore, e
// bloqueio automático por isto é PROIBIDO por decisão do Alex (2026-08-08).
//
// Mapa oficial das 10 regiões fiscais da Receita Federal.

const REGION_STATES = {
  0: ["RS"],
  1: ["DF", "GO", "MS", "MT", "TO"],
  2: ["AC", "AM", "AP", "PA", "RO", "RR"],
  3: ["CE", "MA", "PI"],
  4: ["AL", "PB", "PE", "RN"],
  5: ["BA", "SE"],
  6: ["MG"],
  7: ["ES", "RJ"],
  8: ["SP"],
  9: ["PR", "SC"],
};

/** Região fiscal (0–9) codificada no CPF, ou null se o CPF não tiver 11 dígitos. */
function regionDigit(cpf) {
  const digits = String(cpf || "").replace(/\D/g, "");
  if (digits.length !== 11) return null;
  return Number(digits[8]);
}

/** UFs da região fiscal de um CPF (array vazio se indeterminado). */
function statesForCPF(cpf) {
  const d = regionDigit(cpf);
  if (d == null) return [];
  return REGION_STATES[d] || [];
}

/**
 * Compara a região fiscal do CPF com a UF declarada.
 * @returns {"match"|"mismatch"|"unknown"} unknown quando falta CPF ou UF.
 */
function compareRegion(cpf, uf) {
  const states = statesForCPF(cpf);
  const state = String(uf || "").trim().toUpperCase();
  if (states.length === 0 || !/^[A-Z]{2}$/.test(state)) return "unknown";
  return states.includes(state) ? "match" : "mismatch";
}

module.exports = { REGION_STATES, regionDigit, statesForCPF, compareRegion };
