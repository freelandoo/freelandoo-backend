// src/utils/mmItems/catalog/materials.js — trilha E, fatia E1: materiais por família de atividade (as peças da forja estão em recipes.js).
// Movido de meuMundoGear.js sem mudar nenhum número, nome ou texto (prova: meuMundoItensCatalogo.test.js).
"use strict";

const { G } = require("./_base");

const ITEMS = Object.freeze([
  G("fragmento_lamina", "material", "Fragmento de lâmina", "common", { family: "forja", sell: 4 }),
  G("nucleo_eter", "material", "Núcleo de éter", "uncommon", { family: "forja", sell: 12 }),
  G("selo_forja", "material", "Selo de forja", "rare", { family: "forja", sell: 30 }),
  G("couro_reforcado", "material", "Couro reforçado", "common", { family: "couro", sell: 4 }),
  G("rebite", "material", "Rebites", "common", { family: "couro", sell: 3 }),
  G("pigmento_eter", "material", "Pigmento de éter", "uncommon", { family: "pigmento", sell: 10 }),
  G("mola_precisao", "material", "Mola de precisão", "common", { family: "mola", sell: 4 }),
  G("injetor_vapor", "material", "Injetor de vapor", "common", { family: "vapor", sell: 5 }),
  G("capacitor", "material", "Capacitor", "common", { family: "capacitor", sell: 5 }),
  G("rolamento", "material", "Rolamento", "common", { family: "rolamento", sell: 4 }),
  G("sucata_bronze", "material", "Sucata de bronze", "common", { family: "forja", sell: 3 }),
  G("engrenagem_precisao", "material", "Engrenagem de precisão", "uncommon", { family: "forja", sell: 6 }),
  G("liga_leve", "material", "Liga leve", "uncommon", { family: "capacitor", sell: 8 }),
  G("insignia_ringue", "material", "Insígnia do ringue", "uncommon", { family: "couro", sell: 12 }),
  G("fibra_resistente", "material", "Fibra resistente", "common", { family: "mola", sell: 4 }),
  G("medalhao_travessia", "material", "Medalhão da travessia", "uncommon", { family: "mola", sell: 12 }),
  G("celula_energia", "material", "Célula de energia de éter", "uncommon", { family: "vapor", sell: 9 }),
]);

const DESCRIPTIONS = Object.freeze({
  fragmento_lamina: "Metal recuperado das lutas: matéria-prima da forja e custo base do refinamento de armas.",
  nucleo_eter: "Matéria-prima de energia para peças, acessórios e refinamentos. Pode ser condensada sem sorteio.",
  selo_forja: "Certificação usada na montagem solar, refinamentos altos e proteção opcional. Também pode ser fabricada sem sorteio.",
  couro_reforcado: "Matéria-prima de proteção, empunhaduras e fibras; custo base do refinamento de armaduras.",
  rebite: "Fixador de latão usado em estruturas, travas, proteção e engrenagens.",
  pigmento_eter: "Pigmento condutor usado em focos, núcleos, circuitos e cosméticos de éter.",
  mola_precisao: "Mola mecânica para travas e estabilizadores; também integra luvas e medalhões de forja.",
  injetor_vapor: "Componente bruto de propulsão usado em células de energia e injetores de arma.",
  capacitor: "Componente de levitação usado em células, estabilizadores e reguladores.",
  rolamento: "Componente de bronze usado em buchas e no acessório Núcleo de equilíbrio.",
  sucata_bronze: "Metal básico recuperado, usado para fabricar fixadores, estruturas e ligas.",
  engrenagem_precisao: "Engrenagem usinada para travas, pomos, anéis, selos e reguladores solares.",
  liga_leve: "Liga estrutural usada em lâminas, hastes, carcaças e blindagens de núcleo.",
  insignia_ringue: "Peça de forja inspirada no ringue: integra guardas, anéis e amuletos. Não é uma classificação competitiva.",
  fibra_resistente: "Fibra produzida a partir de couro, usada em empunhaduras, hastes e circuitos.",
  medalhao_travessia: "Medalhão de forja usado em pomos, coroas e acessórios. É distinto do Medalhão lunar equipado.",
  celula_energia: "Célula de energia de éter montada com injetores e capacitores; alimenta peças e rastros.",
});

module.exports = { ITEMS, DESCRIPTIONS };
