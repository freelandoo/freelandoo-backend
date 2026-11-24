// src/utils/mmItems/catalog/retired.js — o que SAIU do jogo com a forja/refino novos (weapon-v1, 24/11/2026).
//
// Pedido do Alex: "tudo que não estiver no prompt, que for de forja e refinamento, você exclui do jogo".
// Fica: refinamento das ARMAS com os 9 pós, forja de ARMAS por fragmento de classe e estrelas por cópia
// idêntica; e o que não é forja de arma — Criogenia/bestiário (amuletos, fragmentos de personagem e de
// deus, embriões), preparos, fichas e a loja de troca. Sai: aprimoramento +0…+15, graus com catalisador,
// Ascensão, Despertar, encanto, runas, desmontar, transmutar, peças/montagens/conversões, projetos e
// receitas, fragmentos de arma específica e os materiais que só serviam a isso.
//
// Ninguém perde patrimônio: a pilha aposentada que a conta tinha vira pó/fragmento novo na primeira vez
// que a mochila abre (MeuMundoGearStorage.convertRetired, chamado pelo `prepare`), com linha no livro.
// O bônus já investido nas cópias (graus, runas engastadas, despertar, encanto, +N das não-armas) continua
// valendo; só não dá mais para investir. O item aposentado fica no catálogo (recibos e cópias antigas
// precisam do nome), marcado `retired`, sem origem e fora das telas de obter.
"use strict";

const { LEGACY_POWDERS } = require("../rules/weaponProgress");

// 24/11/2026 — regra nova do Alex: "não existe mais fabricação por material; tudo por FRAGMENTO". Os materiais
// que ainda ficavam (couro, injetor, madeira, pó de forja e os 14 dos Domínios, dos preparos e amuletos) saíram
// também: a receita pede só fragmentos. A conversão é a MESMA regra idempotente de cima (sem migration): no
// `prepare` da mochila a pilha vira o fragmento que a substitui (EXPLICIT abaixo), com linha no livro.
/** Materiais/fichas que continuam no jogo (nenhum material: tudo por fragmento). */
const KEEP = new Set([]);
const STACK_CATEGORIES = new Set(["material", "currency", "fragment", "recipe", "rune"]);

/** Pilha aposentada? (equipamento, missão e cosmético nunca são convertidos: a cópia continua da pessoa). */
function isRetiredStack(item) {
  if (!item || !STACK_CATEGORIES.has(item.category)) return false;
  if (KEEP.has(item.id)) return false;
  if (item.id.startsWith("embriao_") || item.id.startsWith("ficha_")) return false;
  if (item.id === "faisca_eter") return false; // gacha-v1 (24/11): o giro das Convocações
  if (item.id.startsWith("frag_amuleto_") || item.id.startsWith("frag_personagem_") || item.id.startsWith("frag_deus_")) return false;
  if (item.fragment && item.fragment.forge) return false; // fragmento de peça/preparo da Forja (24/11)
  if (item.id in LEGACY_POWDERS) return true; // weapon-v2: pós SSS I/II/III → pó da classe
  if (item.id.startsWith("po_ref_") || item.id.startsWith("frag_classe_")) return false;
  return true;
}

/** Conversões com nome (o resto segue a régua por tier). [destino, entrada, saída] = ceil(qtd × saída / entrada). */
const EXPLICIT = Object.freeze({
  pedra_aprimoramento: ["po_ref_d", 1, 1],
  po_refino: ["po_ref_d", 10, 1],
  catalisador_refino: ["po_ref_ss", 1, 1],
  selo_dominio: ["po_ref_s", 1, 1],
  essencia_primordial: ["po_ref_ssr", 1, 1],
  // weapon-v2 (24/11): o pó passou a ser da CLASSE; os três SSS viram SSR/Lendária/Divina, 1:1
  ...Object.fromEntries(Object.entries(LEGACY_POWDERS).map(([from, to]) => [from, [to, 1, 1]])),
  cristal_bruto: ["po_ref_b", 2, 1],
  lingote_refinado: ["po_ref_a", 2, 1],
  minerio_ferro: ["po_ref_d", 4, 1],
  minerio_prata: ["po_ref_c", 4, 1],
  brasa_solar: ["po_ref_c", 2, 1],
  cinza_das_correntes: ["po_ref_c", 2, 1],
  barro_primordial: ["po_ref_c", 2, 1],
  // fragmentos da arma de linha (60 faziam a arma) → fragmento de classe Lendária (20 fazem uma Lendária à escolha)
  frag_primeira_chama: ["frag_classe_legendary", 3, 1], frag_tridente_mares: ["frag_classe_legendary", 3, 1],
  frag_lamina_correntes: ["frag_classe_legendary", 3, 1], frag_martelo_incandescente: ["frag_classe_legendary", 3, 1],
  frag_sabre_vendaval: ["frag_classe_legendary", 3, 1], frag_arco_prismatico: ["frag_classe_legendary", 3, 1],
  frag_garras_lunares: ["frag_classe_legendary", 3, 1], frag_arco_bronze_vivo: ["frag_classe_legendary", 3, 1],
  frag_cajado_moldes: ["frag_classe_legendary", 3, 1],
  // fragmentos de conjunto (20 faziam uma peça rara) → fragmento de classe B
  frag_vigilia: ["frag_classe_b", 2, 1], frag_forja: ["frag_classe_b", 2, 1], frag_sentinela: ["frag_classe_b", 2, 1],
  // 24/11/2026 (tudo por fragmento): material comum do Domínio → fragmento do preparo dele, 1:1; o raro →
  // fragmento do amuleto do Domínio, 1:1; couro/injetor → fragmento do preparo; madeira e pó de forja → pó E
  po_de_lua: ["frag_colirio_mira", 1, 1], areia_de_raio: ["frag_graxa_botas", 1, 1], gelo_negro: ["frag_tonico_vida", 1, 1],
  engrenagem_fina: ["frag_verniz_couraca", 1, 1], escoria: ["frag_oleo_lamina", 1, 1], vidro_colorido: ["frag_cha_engrenagem", 1, 1],
  folha_rubra: ["frag_oleo_lamina", 1, 1],
  seiva_de_prata: ["frag_amuleto_floresta", 1, 1], pena_de_tempestade: ["frag_amuleto_canion", 1, 1], perola_de_afogado: ["frag_amuleto_gelo", 1, 1],
  coracao_de_corda: ["frag_amuleto_fabrica", 1, 1], ferro_de_basalto: ["frag_amuleto_vulcao", 1, 1], prisma_vivo: ["frag_amuleto_orbital", 1, 1],
  brasa_de_estandarte: ["frag_amuleto_vermelha", 1, 1],
  couro_reforcado: ["frag_po_garra", 1, 1], injetor_vapor: ["frag_vapor_folego", 1, 1],
  madeira_ancestral: ["po_ref_e", 1, 1], po_forja: ["po_ref_e", 2, 1],
});
/** Régua por tier para o resto (peças, materiais da forja, runas, projetos). */
const BY_TIER = Object.freeze({ 1: ["po_ref_d", 4, 1], 2: ["po_ref_d", 2, 1], 3: ["po_ref_c", 1, 1], 4: ["po_ref_b", 1, 1], 5: ["po_ref_a", 1, 1], 6: ["po_ref_s", 1, 1] });

/** Compensação de `qty` unidades do item aposentado: { id, qty } (qty ≥ 1 quando havia algo). */
function compensation(item, qty) {
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  if (!n) return null;
  const [id, inN, outN] = EXPLICIT[item.id] || BY_TIER[item.tier] || BY_TIER[1];
  return { id, qty: Math.max(1, Math.ceil((n * outN) / inN)) };
}

/** Receita que continua (bestiário/Criogenia, preparos e proteções por fragmento — `keep`); as outras saíram. */
const keepRecipe = (r) => r.kind === "prep" || r.keep === true || /^fabricar_(amuleto|embriao)_/.test(r.id);

module.exports = { KEEP, isRetiredStack, EXPLICIT, BY_TIER, compensation, keepRecipe };
