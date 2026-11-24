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

/** Materiais/fichas que continuam no jogo (preparos, bestiário, Criogenia, fichas). */
const KEEP = new Set([
  "couro_reforcado", "injetor_vapor", "madeira_ancestral", "po_forja",
  "po_de_lua", "seiva_de_prata", "areia_de_raio", "pena_de_tempestade", "gelo_negro", "perola_de_afogado",
  "engrenagem_fina", "coracao_de_corda", "escoria", "ferro_de_basalto", "vidro_colorido", "prisma_vivo",
  "folha_rubra", "brasa_de_estandarte",
]);
const STACK_CATEGORIES = new Set(["material", "currency", "fragment", "recipe", "rune"]);

/** Pilha aposentada? (equipamento, missão e cosmético nunca são convertidos: a cópia continua da pessoa). */
function isRetiredStack(item) {
  if (!item || !STACK_CATEGORIES.has(item.category)) return false;
  if (KEEP.has(item.id)) return false;
  if (item.id.startsWith("embriao_") || item.id.startsWith("ficha_")) return false;
  if (item.id.startsWith("frag_amuleto_") || item.id.startsWith("frag_personagem_") || item.id.startsWith("frag_deus_")) return false;
  if (item.id.startsWith("po_ref_") || item.id.startsWith("frag_classe_")) return false;
  return true;
}

/** Conversões com nome (o resto segue a régua por tier). [destino, entrada, saída] = ceil(qtd × saída / entrada). */
const EXPLICIT = Object.freeze({
  pedra_aprimoramento: ["po_ref_d", 1, 1],
  po_refino: ["po_ref_d", 10, 1],
  catalisador_refino: ["po_ref_ss", 1, 1],
  selo_dominio: ["po_ref_s", 1, 1],
  essencia_primordial: ["po_ref_sss1", 1, 1],
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

/** Receita que continua (bestiário/Criogenia e preparos); as outras saíram. */
const keepRecipe = (r) => r.kind === "prep" || /^fabricar_(amuleto|embriao)_/.test(r.id);

module.exports = { KEEP, isRetiredStack, EXPLICIT, BY_TIER, compensation, keepRecipe };
