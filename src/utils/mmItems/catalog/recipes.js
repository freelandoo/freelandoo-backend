// src/utils/mmItems/catalog/recipes.js — trilha E, fatia E1: RECEITAS da forja.
// Peças (COMPONENTS → PART_RECIPES), montagens das armas de classe (ASSEMBLIES), conversões garantidas
// (CONVERSIONS) e as receitas diretas de equipamento, missão e cosmético (ITEM_RECIPES). Movido de
// meuMundoForge.js e meuMundoGear.js sem mudar quantidade, custo ou nível.
"use strict";

const { G } = require("./_base");

const SHARED = Object.freeze(["peca_empunhadura", "peca_condutor", "peca_nucleo", "peca_trava", "peca_bucha", "peca_carcaca"]);
const SWORD = Object.freeze(["peca_lamina", "peca_fio", "peca_guarda", "peca_pomo"]);
const STAFF = Object.freeze(["peca_haste", "peca_coroa", "peca_foco", "peca_anel"]);
const ETHER = Object.freeze(["peca_estabilizador", "peca_injetor"]);
const SOLAR = Object.freeze(["peca_regulador", "peca_blindagem", "peca_retorno"]);

const part = (id, name, needs, coins, level, description) => Object.freeze({ id, name, needs: Object.freeze(needs), coins, level, description });
// Each recipe makes exactly ONE part. Shared parts work in either weapon family;
// there are no hidden grades and item.level remains the existing refinement level.
const COMPONENTS = Object.freeze([
  part("peca_empunhadura", "Empunhadura revestida", { couro_reforcado: 4, fibra_resistente: 3, rebite: 2 }, 80, 2, "Pegada isolada e revestida, comum a espadas e cajados."),
  part("peca_condutor", "Condutor de éter", { liga_leve: 3, pigmento_eter: 1, fragmento_lamina: 2 }, 100, 2, "Canal que conduz energia entre a arma e seu núcleo."),
  part("peca_nucleo", "Núcleo condutor montado", { nucleo_eter: 2, celula_energia: 1, fragmento_lamina: 3 }, 140, 2, "Núcleo de arma montado; diferente da matéria-prima Núcleo de éter."),
  part("peca_trava", "Trava de precisão", { engrenagem_precisao: 2, mola_precisao: 2, rebite: 4 }, 100, 2, "Trava que mantém os componentes alinhados durante o golpe."),
  part("peca_bucha", "Bucha de articulação", { rolamento: 2, sucata_bronze: 4, rebite: 2 }, 90, 2, "Bucha ajustada para unir a estrutura à empunhadura."),
  part("peca_carcaca", "Carcaça rebitada", { liga_leve: 4, sucata_bronze: 6, rebite: 4 }, 130, 2, "Estrutura externa de uma arma, sem bônus quando solta."),
  part("peca_lamina", "Corpo da lâmina", { fragmento_lamina: 12, liga_leve: 4 }, 200, 2, "Corpo metálico exclusivo da montagem de espadas."),
  part("peca_fio", "Fio temperado", { fragmento_lamina: 8, pigmento_eter: 2 }, 140, 2, "Fio tratado que completa o corpo de uma espada."),
  part("peca_guarda", "Guarda do duelista", { sucata_bronze: 6, couro_reforcado: 2, insignia_ringue: 1 }, 160, 2, "Guarda de espada com a insígnia incrustada."),
  part("peca_pomo", "Pomo de contrapeso", { sucata_bronze: 4, engrenagem_precisao: 2, medalhao_travessia: 1 }, 180, 2, "Contrapeso de espada com o medalhão da travessia."),
  part("peca_haste", "Haste segmentada", { liga_leve: 6, fibra_resistente: 4 }, 190, 2, "Estrutura longa exclusiva da montagem de cajados."),
  part("peca_coroa", "Coroa do cajado", { sucata_bronze: 6, pigmento_eter: 2, medalhao_travessia: 1 }, 170, 2, "Suporte superior do cajado, com o medalhão incrustado."),
  part("peca_foco", "Foco prismático", { nucleo_eter: 3, pigmento_eter: 3 }, 210, 2, "Foco que concentra a energia do cajado."),
  part("peca_anel", "Anel de fixação", { sucata_bronze: 4, engrenagem_precisao: 2, insignia_ringue: 1 }, 170, 2, "Anel de cajado com a insígnia gravada."),
  part("peca_estabilizador", "Estabilizador de éter", { capacitor: 2, mola_precisao: 3, liga_leve: 4 }, 320, 3, "Peça adicional exigida pelas armas de éter e solares."),
  part("peca_injetor", "Injetor de arma montado", { injetor_vapor: 3, celula_energia: 2, pigmento_eter: 2 }, 360, 3, "Injetor calibrado para a arma; usa injetores de vapor como matéria-prima."),
  part("peca_regulador", "Regulador solar", { selo_forja: 1, engrenagem_precisao: 4, capacitor: 3 }, 600, 8, "Regulador certificado, exclusivo da montagem solar."),
  part("peca_blindagem", "Blindagem do núcleo", { nucleo_eter: 4, liga_leve: 8, couro_reforcado: 4 }, 700, 8, "Isolamento reforçado para o núcleo de uma arma solar."),
  part("peca_retorno", "Circuito de retorno", { celula_energia: 3, fibra_resistente: 6, pigmento_eter: 4 }, 800, 8, "Circuito que fecha a montagem de uma arma solar."),
]);

function assemblyParts(family, tier) {
  if (!['espada', 'cajado'].includes(family) || ![1, 2, 3].includes(tier)) return [];
  return [...SHARED, ...(family === "espada" ? SWORD : STAFF), ...(tier >= 2 ? ETHER : []), ...(tier >= 3 ? SOLAR : [])];
}

const assembly = (family, tier, suffix, coins, level, recipe) => Object.freeze({
  id: `forjar_${family}_${suffix}`, kind: "assembly", out: `${family}_${suffix}`, qty: 1,
  needs: Object.freeze(Object.fromEntries(assemblyParts(family, tier).map((id) => [id, 1]))),
  coins, level, recipe, family, tier, parts: Object.freeze(assemblyParts(family, tier)),
});
const ASSEMBLIES = Object.freeze([
  assembly("espada", 1, "latao", 300, 2, "receita_latao"),
  assembly("cajado", 1, "latao", 300, 2, "receita_latao"),
  assembly("espada", 2, "eter", 1000, 3, "receita_eter"),
  assembly("cajado", 2, "eter", 1000, 3, "receita_eter"),
  assembly("espada", 3, "solar", 3000, 8, "receita_eter"),
  assembly("cajado", 3, "solar", 3000, 8, "receita_eter"),
]);

const conversion = (id, out, needs, coins, level = 2) => Object.freeze({ id, kind: "conversion", out, qty: 1, needs: Object.freeze(needs), coins, level, recipe: null });
// Guaranteed alternatives prevent any rare random drop from being the only gate.
const CONVERSIONS = Object.freeze([
  conversion("recuperar_bronze", "sucata_bronze", { fragmento_lamina: 2 }, 12),
  conversion("produzir_rebite", "rebite", { sucata_bronze: 1 }, 15),
  conversion("tecer_fibra", "fibra_resistente", { couro_reforcado: 2 }, 25),
  conversion("usinar_engrenagem", "engrenagem_precisao", { sucata_bronze: 3, rebite: 2 }, 35),
  conversion("fundir_liga", "liga_leve", { sucata_bronze: 4, fragmento_lamina: 2 }, 60),
  conversion("destilar_pigmento", "pigmento_eter", { fragmento_lamina: 6, sucata_bronze: 2 }, 80),
  conversion("condensar_nucleo", "nucleo_eter", { fragmento_lamina: 8, pigmento_eter: 1 }, 80),
  conversion("certificar_selo", "selo_forja", { fragmento_lamina: 20, nucleo_eter: 4, engrenagem_precisao: 2 }, 650, 3),
  conversion("cunhar_insignia", "insignia_ringue", { couro_reforcado: 12, rebite: 8 }, 90),
  conversion("cunhar_medalhao", "medalhao_travessia", { mola_precisao: 10, fibra_resistente: 6 }, 110),
  conversion("montar_celula", "celula_energia", { injetor_vapor: 4, capacitor: 2 }, 120),
  conversion("montar_capacitor", "capacitor", { sucata_bronze: 4, nucleo_eter: 1 }, 65),
  conversion("montar_injetor", "injetor_vapor", { sucata_bronze: 4, rebite: 4 }, 40),
  conversion("usinar_rolamento", "rolamento", { sucata_bronze: 3, mola_precisao: 1 }, 30),
  conversion("temperar_mola", "mola_precisao", { sucata_bronze: 3, rebite: 1 }, 30),
  conversion("copiar_receita_latao", "receita_latao", { fragmento_lamina: 12, sucata_bronze: 12 }, 400),
  conversion("copiar_receita_eter", "receita_eter", { nucleo_eter: 6, pigmento_eter: 6, selo_forja: 2 }, 1000, 3),
  conversion("copiar_receita_colete", "receita_colete", { couro_reforcado: 12, rebite: 16 }, 350),
]);
const PART_RECIPES = Object.freeze(COMPONENTS.map((p) => Object.freeze({
  id: `fabricar_${p.id}`, kind: "part", out: p.id, qty: 1, needs: p.needs,
  coins: p.coins, level: p.level, recipe: null,
})));

/** Receitas diretas (equipamento, missão e cosmético) — a ordem é a do RECIPES público. */
const ITEM_RECIPES = Object.freeze([
  { id: "forjar_couraca", out: "couraca_rebitada", needs: { couro_reforcado: 6, rebite: 8 }, coins: 150, recipe: null, level: 3 },
  { id: "forjar_luvas", out: "luvas_precisao", needs: { couro_reforcado: 3, mola_precisao: 4 }, coins: 90, recipe: null, level: 2 },
  { id: "forjar_colete", kind: "equipment", out: "colete_couro", needs: { couro_reforcado: 6, fibra_resistente: 3, rebite: 6 }, coins: 120, recipe: "receita_colete", level: 2 },
  { id: "forjar_medalhao_lunar", kind: "equipment", out: "medalhao_lunar", needs: { medalhao_travessia: 2, nucleo_eter: 4, pigmento_eter: 4 }, coins: 550, recipe: null, level: 3 },
  { id: "forjar_nucleo_equilibrio", kind: "equipment", out: "nucleo_equilibrio", needs: { capacitor: 4, nucleo_eter: 4, rolamento: 4 }, coins: 550, recipe: null, level: 3 },
  { id: "forjar_amuleto_aurion", kind: "equipment", out: "amuleto_aurion", needs: { selo_forja: 2, nucleo_eter: 6, insignia_ringue: 2 }, coins: 1000, recipe: null, level: 3 },
  { id: "reunir_vestigios_morkhan", kind: "conversion", out: "cristal_morkhan", needs: { nucleo_eter: 6, pigmento_eter: 6, selo_forja: 1 }, coins: 600, recipe: null, level: 3 },
  { id: "reconstituir_diario", kind: "conversion", out: "diario_sem_nome", needs: { fragmento_lamina: 12, pigmento_eter: 4 }, coins: 200, recipe: null, level: 3 },
  { id: "reconstituir_chave", kind: "conversion", out: "chave_subestacao", needs: { sucata_bronze: 8, engrenagem_precisao: 2, nucleo_eter: 1 }, coins: 180, recipe: null, level: 3 },
  { id: "produzir_pintura_eter", kind: "equipment", out: "pintura_arma_eter", needs: { pigmento_eter: 8, nucleo_eter: 2 }, coins: 450, recipe: null, level: 3 },
  { id: "produzir_rastro_eter", kind: "equipment", out: "rastro_eter", needs: { pigmento_eter: 10, celula_energia: 3 }, coins: 600, recipe: null, level: 3 },
  { id: "registrar_saudacao", kind: "equipment", out: "emote_saudacao", needs: { insignia_ringue: 1, medalhao_travessia: 1 }, coins: 250, recipe: null, level: 2 },
]);

/** As peças viram material empilhável no catálogo (raridade pelo nível da peça). */
const COMPONENT_ITEMS = Object.freeze(COMPONENTS.map((p) => G(p.id, "material", p.name, p.level >= 8 ? "epic" : p.level >= 3 ? "rare" : "uncommon", { component: true, level: p.level, sell: Math.max(1, Math.floor(p.coins / 10)), description: p.description })));

module.exports = { SHARED, SWORD, STAFF, ETHER, SOLAR, COMPONENTS, COMPONENT_ITEMS, ASSEMBLIES, CONVERSIONS, PART_RECIPES, ITEM_RECIPES, assemblyParts };
