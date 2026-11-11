// src/utils/meuMundoForge.js — regras puras da forja. O serviço cuida de saldo, recibo, sorteio e proposta.
//
// Desde a trilha E, fatia E1, este arquivo é só FACHADA (mesmos exports de antes):
//  • peças, montagens e conversões moram em `mmItems/catalog/recipes.js`;
//  • o refino sorteado (forge-v1: custo, chances, piso, proteção, `quote`/`roll`) mora em
//    `mmItems/rules/forgeV1.js`.
"use strict";

const Recipes = require("./mmItems/catalog/recipes");
const V1 = require("./mmItems/rules/forgeV1");

module.exports = {
  RULES_VERSION: V1.RULES_VERSION,
  MAX_LEVEL: V1.MAX_LEVEL,
  PROPOSAL_TTL_MS: V1.PROPOSAL_TTL_MS,
  COINS: V1.COINS,
  MATERIALS: V1.MATERIALS,
  NUCLEI: V1.NUCLEI,
  SEALS: V1.SEALS,
  SECONDARY_PER_LEVEL: V1.SECONDARY_PER_LEVEL,
  COMPONENTS: Recipes.COMPONENTS,
  ASSEMBLIES: Recipes.ASSEMBLIES,
  CONVERSIONS: Recipes.CONVERSIONS,
  PART_RECIPES: Recipes.PART_RECIPES,
  assemblyParts: Recipes.assemblyParts,
  quote: V1.quote,
  roll: V1.roll,
};
