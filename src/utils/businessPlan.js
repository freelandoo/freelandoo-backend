// src/utils/businessPlan.js
// O Plano NEGÓCIO (mig 234) — fonte ÚNICA das chaves que ele gateia.
//
// O negócio (comunidade `common`) e o construtor do site são de todo mundo.
// O plano libera três portas, e cada uma tem UMA chave — a mesma que está em
// `tb_plan_feature` e em `USER_FEATURE_KEYS`:
//
//   members   → aceitar membro (join, checkout de mensalidade, convite)
//   siteShare → PUBLICAR o site (montar é livre; publicar é o que compartilha)
//   ai        → o Atendimento IA incluído no plano
//
// Escrito solto em cada porta ("site_share" aqui, "site-share" ali), a que
// errasse a grafia liberaria de graça — em silêncio, porque chave desconhecida
// cai no ramo "grátis" do ownership.

const BUSINESS_PLAN_SLUG = "profissional";

const BUSINESS_GATES = Object.freeze({
  members: "community_members",
  siteShare: "site_share",
  ai: "atendimento_ia",
});

const BUSINESS_GATE_KEYS = Object.freeze(Object.values(BUSINESS_GATES));

/** Nome do plano de Atendimento IA que o Plano Negócio abre (seed da mig 234). */
const INCLUDED_AI_PLAN_NAME = "Incluído no Plano Negócio";

module.exports = {
  BUSINESS_PLAN_SLUG,
  BUSINESS_GATES,
  BUSINESS_GATE_KEYS,
  INCLUDED_AI_PLAN_NAME,
};
