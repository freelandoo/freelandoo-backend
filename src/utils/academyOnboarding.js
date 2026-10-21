// src/utils/academyOnboarding.js
// Conta criada por uma academia (API de parceiro, mig 296) nasce
// 'aguardando_aceite' e fica INVISÍVEL no resto da plataforma até o aluno
// aceitar os termos no modal (decisão Q19). Este é o predicado único que as
// consultas públicas (vitrine, ranking, perfil público) usam para escondê-la.
const ESTADO_AGUARDANDO = "aguardando_aceite";
const ESTADO_ATIVA = "ativa";

// Versão dos termos registrada no aceite (tb_user_consent.versao_termos).
const VERSAO_TERMOS_ACADEMIA = "2026-10-20";

/** SQL: o usuário `alias` NÃO está aguardando aceite. */
function notPendingAcademyUserSql(alias) {
  return `${alias}.academy_onboarding_state IS DISTINCT FROM '${ESTADO_AGUARDANDO}'`;
}

module.exports = {
  ESTADO_AGUARDANDO,
  ESTADO_ATIVA,
  VERSAO_TERMOS_ACADEMIA,
  notPendingAcademyUserSql,
};
