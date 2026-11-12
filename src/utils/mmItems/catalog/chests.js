// src/utils/mmItems/catalog/chests.js — trilha E, fatia E18: BAÚS e a RECEITA OCULTA.
//
// Cada baú mora num PONTO DE VISITA que a sala já registra (bairro: meuMundoLayout.VISIT_POINTS;
// centro: meuMundoCenter.VISIT_POINTS). Abrir pede que a última visita da pessoa tenha sido a um
// desses pontos (MeuMundoPlaceService.isAt) e entrega UMA vez por conta (tb_mm_chest_open, mig 450).
// O conteúdo é fixo (tabela `chest:<id>`, sem sorteio). A receita oculta só sai de baú e fica fora do
// catálogo público até a conta descobri-la (`hidden`).
"use strict";

const { G } = require("./_base");

const CHESTS = Object.freeze([
  { id: "bau_ninho", where: "bairro", places: ["ninho"], name: "Baú do Ninho", gives: { pedra_aprimoramento: 3, po_refino: 30 } },
  { id: "bau_estatua_aurion", where: "bairro", places: ["estatua_aurion"], name: "Baú da estátua de Aurion", gives: { brasa_solar: 3, runa_ataque_1: 1 } },
  { id: "bau_praca", where: "centro", places: ["praca"], name: "Baú da praça", gives: { minerio_ferro: 5, madeira_ancestral: 2 } },
  { id: "bau_estatua_morkhan", where: "centro", places: ["estatua_morkhan"], name: "Baú do pedestal de Morkhan", gives: { cinza_das_correntes: 3, runa_forca_1: 1 } },
  { id: "bau_portal", where: "centro", places: ["portal", "portal_dominios"], name: "Baú do portal", gives: { cristal_bruto: 2, essencia_primordial: 1 } },
  { id: "bau_biblioteca", where: "centro", places: ["biblioteca"], name: "Baú da biblioteca", gives: { receita_oculta_forca: 1, po_refino: 20 } },
].map((c) => Object.freeze({ ...c, places: Object.freeze(c.places), gives: Object.freeze(c.gives), table: `chest:${c.id}` })));
const CHEST_BY_ID = new Map(CHESTS.map((c) => [c.id, c]));

/** Tabelas `chest:<id>`: só o garantido, quantidade fixa (não sorteia). */
const TABLES = Object.freeze(Object.fromEntries(CHESTS.map((c) => [c.table, Object.freeze({
  label: c.name, chest: c.id,
  sure: Object.freeze(Object.entries(c.gives).map(([id, n]) => Object.freeze({ id, qty: Object.freeze([n, n]) }))),
})])));

// ── a receita oculta: grava uma Runa de Acuracidade II na Forja ──
const ITEMS = Object.freeze([
  G("receita_oculta_forca", "recipe", "Receita oculta: Runa de Acuracidade", "epic", { sell: 0, hidden: true }),
]);
const RECIPES = Object.freeze([
  Object.freeze({ id: "gravar_runa_forca", kind: "conversion", out: "runa_forca_2", qty: 1, needs: Object.freeze({ cristal_bruto: 3, po_forja: 4, madeira_ancestral: 1 }), coins: 120, level: 1, recipe: "receita_oculta_forca", hidden: true }),
]);
const DESCRIPTIONS = Object.freeze({
  receita_oculta_forca: "Folhas soltas achadas num baú da biblioteca: como gravar a marca da mira numa pedra bruta.",
});

module.exports = { CHESTS, CHEST_BY_ID, TABLES, ITEMS, RECIPES, DESCRIPTIONS };
