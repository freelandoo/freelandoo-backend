// src/utils/condoRules.js
// Regras de dado sensível do Condomínio (mig 196), em um lugar só.
//
// O que é sensível: rua, número, complemento, CEP do prédio e, principalmente,
// QUEM mora em QUAL unidade/vaga. Cidade/UF/bairro são públicos de propósito —
// é por eles que o condomínio é encontrado na busca.
//
// Fonte única para: validar/normalizar endereço, mascarar o endereço para quem
// não é morador confirmado e formatar o rótulo de uma unidade.

const COMMUNITY_KINDS = ["common", "academy", "condo"];

const MAX = {
  street: 160,
  number: 20,
  complement: 80,
  neighborhood: 120,
  cep: 9,
  estado: 2,
  municipio: 120,
};

function trimOrNull(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

const CondoRules = {
  COMMUNITY_KINDS,

  // Cidade e UF são obrigatórias: sem elas o condomínio não é achável e fica
  // fora da resolução de região (tb_region_city).
  validateAddress(address) {
    const a = address || {};
    const estado = trimOrNull(a.estado, MAX.estado);
    const municipio = trimOrNull(a.municipio, MAX.municipio);
    if (!estado || estado.length !== 2) {
      return "Informe o estado (UF) do condomínio.";
    }
    if (!municipio) return "Informe a cidade do condomínio.";
    if (!trimOrNull(a.street, MAX.street)) {
      return "Informe o logradouro (rua/avenida) do condomínio.";
    }
    return null;
  },

  normalizeAddress(address) {
    const a = address || {};
    return {
      street: trimOrNull(a.street, MAX.street),
      number: trimOrNull(a.number, MAX.number),
      complement: trimOrNull(a.complement, MAX.complement),
      neighborhood: trimOrNull(a.neighborhood, MAX.neighborhood),
      cep: trimOrNull(a.cep, MAX.cep),
      estado: (trimOrNull(a.estado, MAX.estado) || "").toUpperCase() || null,
      municipio: trimOrNull(a.municipio, MAX.municipio),
    };
  },

  // Recorta o endereço conforme quem está olhando. `full` só para morador
  // confirmado ou administrador do condomínio.
  publicAddress(row) {
    if (!row) return null;
    return {
      neighborhood: row.condo_neighborhood ?? null,
      municipio: row.municipio ?? null,
      estado: row.estado ?? null,
    };
  },

  fullAddress(row) {
    if (!row) return null;
    return {
      street: row.condo_street ?? null,
      number: row.condo_number ?? null,
      complement: row.condo_complement ?? null,
      neighborhood: row.condo_neighborhood ?? null,
      cep: row.condo_cep ?? null,
      municipio: row.municipio ?? null,
      estado: row.estado ?? null,
    };
  },

  // Tira do payload da comunidade tudo que é endereço de rua — usado quando o
  // visitante não é morador confirmado.
  stripAddressColumns(row) {
    if (!row) return row;
    const out = { ...row };
    delete out.condo_street;
    delete out.condo_number;
    delete out.condo_complement;
    delete out.condo_cep;
    delete out.condo_neighborhood;
    return out;
  },

  unitLabel({ block_name, number }) {
    if (block_name) return `${block_name} · ${number}`;
    return String(number ?? "");
  },
};

module.exports = CondoRules;
