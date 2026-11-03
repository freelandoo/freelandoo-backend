// Pure forge rules. The service owns balances, receipts, randomness and proposals.
"use strict";

const RULES_VERSION = "forge-v1";
const MAX_LEVEL = 10;
const PROPOSAL_TTL_MS = 15 * 60 * 1000;
const COINS = Object.freeze([120, 220, 380, 600, 900, 1400, 2100, 3000, 4200, 5800]);
const MATERIALS = Object.freeze([2, 3, 4, 6, 8, 12, 16, 20, 26, 34]);
const NUCLEI = Object.freeze([0, 0, 0, 1, 2, 3, 4, 5, 6, 8]);
const SEALS = Object.freeze([0, 0, 0, 0, 0, 0, 1, 1, 2, 3]);
const SECONDARY_PER_LEVEL = Object.freeze({ stam: 0.004, warn: 0.004, power: 0.01 });

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

/** A quote contains total costs, including optional protection, never a result. */
function quote(item, currentLevel, options = {}) {
  if (!item || !["weapon", "armor"].includes(item.category)) return null;
  const from = Number(currentLevel);
  if (!Number.isInteger(from) || from < 0 || from >= MAX_LEVEL) return null;
  const failures = Math.max(0, Math.min(3, Math.floor(Number(options.failures) || 0)));
  const protectedAttempt = options.protected === true || options.protection === true;
  const guaranteed = failures >= 3;
  const floor = from >= 6 ? 6 : from >= 3 ? 3 : 0;
  const needs = { [item.category === "weapon" ? "fragmento_lamina" : "couro_reforcado"]: MATERIALS[from] };
  if (NUCLEI[from]) needs.nucleo_eter = NUCLEI[from];
  if (SEALS[from]) needs.selo_forja = SEALS[from];
  let odds = guaranteed ? { up: 1, same: 0, down: 0 } : from < 3 ? { up: 0.75, same: 0.2, down: 0.05 } : from < 6 ? { up: 0.55, same: 0.3, down: 0.15 } : from < 9 ? { up: 0.35, same: 0.4, down: 0.25 } : { up: 0.25, same: 0.45, down: 0.3 };
  // A floor absorbs downgrade probability. Protection is only charged when a
  // downgrade could occur; a guaranteed or floor attempt needs no protection.
  const protectionCost = protectedAttempt && !guaranteed && from > floor ? { selo_forja: from < 3 ? 1 : from < 6 ? 2 : 3 } : {};
  if (from === floor || Object.keys(protectionCost).length) odds = { up: odds.up, same: odds.same + odds.down, down: 0 };
  for (const [id, qty] of Object.entries(protectionCost)) needs[id] = (needs[id] || 0) + qty;
  return {
    rulesVersion: RULES_VERSION, proposalTTLms: PROPOSAL_TTL_MS,
    from, toMax: from + 1, floor, cost: { coins: COINS[from], needs }, odds,
    pity: { failures, guaranteed, guaranteeAfter: 3 },
    protection: { enabled: Object.keys(protectionCost).length > 0, requested: protectedAttempt, cost: { coins: 0, needs: protectionCost } },
  };
}

/** The authenticated service supplies a cryptographically secure random draw. */
function roll(q, R) {
  if (!q || !Number.isInteger(q.from) || !q.odds || typeof R !== "function") throw new TypeError("Invalid refinement quote");
  const draw = R();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new RangeError("Random draw must be in [0,1)");
  if (draw < q.odds.up) return Math.min(MAX_LEVEL, q.from + 1);
  if (draw < q.odds.up + q.odds.same) return q.from;
  return Math.max(q.floor, q.from - 1);
}

module.exports = {
  RULES_VERSION, MAX_LEVEL, PROPOSAL_TTL_MS, COINS, MATERIALS, NUCLEI, SEALS,
  SECONDARY_PER_LEVEL, COMPONENTS, ASSEMBLIES, CONVERSIONS, PART_RECIPES,
  assemblyParts, quote, roll,
};
