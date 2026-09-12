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

// ⚠️ EXISTE UM SEGUNDO PLANO QUE CARREGA ESTAS MESMAS CHAVES: o
// `site-freelandoo` (mig 241), que é o Negócio mais o site feito por nós. Ele
// NÃO herda nada em tempo de execução — o seed COPIOU as chaves uma vez, e
// cópia não é vínculo.
//
// Então: CHAVE NOVA AQUI ENTRA NOS DOIS PLANOS, numa migration que insira as
// duas linhas em `tb_plan_feature`. Esquecida no segundo, quem paga MAIS perde
// uma porta que quem paga menos tem — e o sintoma chega como suporte, não como
// erro. Ver `src/utils/managedSite.js`.
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
