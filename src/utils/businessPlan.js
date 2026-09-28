// src/utils/businessPlan.js
// As chaves das portas do negócio — fonte ÚNICA da grafia.
//
// ─── A HISTÓRIA, EM UMA LINHA POR MIGRATION ─────────────────────────────────
//
//   234 → o Plano Negócio (R$50/mês) gateava as três portas abaixo.
//   263 → o Plano Negócio ACABOU. O que sobrou pago:
//           site_share  → o Plano SITE (R$49/ano) e o Site Autoral
//                         (`site-freelandoo`, R$299 + R$29/mês)
//         e o resto ficou GRÁTIS — `community_members` e `atendimento_ia`
//         não estão em plano ativo nenhum, então caem no terceiro ramo da
//         posse (PlanService.ownershipMap). A cota do atendente passou a ser
//         outra pergunta: `utils/aiQuota.js`.
//
// As chaves continuam aqui mesmo gratuitas: portas espalhadas ("site_share"
// aqui, "site-share" ali) liberariam de graça em silêncio no dia em que uma
// voltasse a ser paga, porque chave desconhecida cai no ramo "grátis".
//
// ⚠️ CHAVE NOVA DE PLANO ENTRA NOS DOIS PLANOS DE SITE, numa migration: o seed
// da 241 COPIOU as chaves uma vez, e cópia não é vínculo.

/** O plano que vende a publicação do site (mig 263). */
const SITE_PLAN_SLUG = "site";

/** Legado: o slug do Plano Negócio, desativado na mig 263. */
const BUSINESS_PLAN_SLUG = "profissional";

const BUSINESS_GATES = Object.freeze({
  members: "community_members",
  siteShare: "site_share",
  ai: "atendimento_ia",
});

const BUSINESS_GATE_KEYS = Object.freeze(Object.values(BUSINESS_GATES));

/** Nome do plano de Atendimento IA que o Plano Negócio abria (seed da mig 234). */
const INCLUDED_AI_PLAN_NAME = "Incluído no Plano Negócio";

module.exports = {
  SITE_PLAN_SLUG,
  BUSINESS_PLAN_SLUG,
  BUSINESS_GATES,
  BUSINESS_GATE_KEYS,
  INCLUDED_AI_PLAN_NAME,
};
