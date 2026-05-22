// Parser compartilhado do opt-in de afiliados por item (migration 090).
// Usado por cursos, produtos de loja e serviços de perfil.
//
// O criador só ACEITA ou RECUSA afiliados — a comissão é a regra global do
// admin. Aqui só lemos/validamos a flag `affiliates_allowed`.
//
// Grava em `out` (o objeto de campos validados do service). Retorna uma
// string de erro se o valor for inválido, ou null se estiver tudo certo.

function parseAffiliateOptIn(payload, out) {
  if (Object.prototype.hasOwnProperty.call(payload, "affiliates_allowed")) {
    if (typeof payload.affiliates_allowed !== "boolean") {
      return "affiliates_allowed deve ser booleano";
    }
    out.affiliates_allowed = payload.affiliates_allowed;
  }
  return null;
}

module.exports = { parseAffiliateOptIn };
