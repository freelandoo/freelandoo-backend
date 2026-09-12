// src/utils/managedSite.js
// O SITE FEITO PELA FREELANDOO (mig 241) — fonte ÚNICA das constantes.
//
// Duas naturezas de site convivem na mesma tabela:
//
//   construtor  → `template IS NULL`, o líder edita, é de todo mundo
//   gerenciado  → `template` aponta um tema autoral e `managed_by_platform`
//                 está ligado: nós desenhamos, nós gravamos, o cliente só vê
//
// ⚠️ A BRECHA É SÓ NOSSA, E ISSO É ESTRUTURAL — NÃO É BOTÃO ESCONDIDO.
// Três coisas, juntas, é que tornam a frase verdadeira:
//
//   1. `template` e `template_data` são COLUNAS, e não campos do documento.
//      O autosave do líder grava o documento; o que não está no documento ele
//      não alcança. (Ver o cabeçalho da mig 241 — a armadilha é alguém
//      declarar `template` em `normalizeConfig` "para completar", e nesse
//      mesmo gesto abrir a porta.)
//   2. `CommunitySiteStorage.upsert` — a porta de escrita do líder — não
//      menciona nenhuma das quatro colunas, do mesmo jeito que não menciona
//      `is_published`.
//   3. Quem grava é UMA rota sob `roleMiddleware("Administrator")`.
//
// Tirar qualquer uma das três abre a brecha, e as outras duas não avisam.

/** O plano que vende o site pronto (seed da mig 241). */
const MANAGED_SITE_PLAN_SLUG = "site-freelandoo";

/**
 * A chave do direito. Vive em `tb_plan_feature` e em `USER_FEATURE_KEYS`.
 *
 * ⚠️ NUNCA criar linha para ela em `tb_function_product` (a Loja de Funções):
 * lá `is_for_sale = FALSE` significa GRÁTIS PARA TODO MUNDO — foi assim que
 * Carteira (216), Academia (217) e Serviços (222) viraram nativas. A chave
 * nasceria liberada para a base inteira, que é o oposto de uma brecha nossa.
 */
const MANAGED_SITE_GATE = "managed_site";

/**
 * Quantos dias o site gerenciado continua no ar depois que o plano termina.
 *
 * Decisão do Alex (2026-09-12): sai do ar, mas não no dia em que o cartão
 * falha — cartão recusado é o caso comum, e derrubar o site de um negócio por
 * causa disso custa mais do que trinta dias de hospedagem.
 *
 * O relógio é gravado em `tb_community_site.grace_until` quando a assinatura
 * termina, e LIMPO quando ela volta. NULL não é "sem prazo": é "o relógio não
 * está correndo".
 */
const MANAGED_SITE_GRACE_DAYS = 30;

/**
 * Este site é gerenciado por nós?
 *
 * Pergunta pelo BIT, nunca por `template != null`: os dois eixos são
 * independentes de propósito (um site do construtor pode ser travado, e um dia
 * um tema pode ganhar edição de dados). Quem responde "o cliente pode editar?"
 * é este predicado, e ele mora num lugar só — espalhado, a porta que esquecesse
 * dele deixaria o cliente gravar por cima do que desenhamos.
 */
function isManaged(row) {
  return !!(row && row.managed_by_platform);
}

/** A recusa que toda porta de escrita devolve. Uma frase só, dita em voz alta. */
function managedRefusal() {
  return {
    error:
      "Este site é feito e mantido pela Freelandoo. Peça as alterações por aqui que a gente aplica.",
    statusCode: 403,
  };
}

module.exports = {
  MANAGED_SITE_PLAN_SLUG,
  MANAGED_SITE_GATE,
  MANAGED_SITE_GRACE_DAYS,
  isManaged,
  managedRefusal,
};
