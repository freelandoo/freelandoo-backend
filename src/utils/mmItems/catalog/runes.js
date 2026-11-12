// src/utils/mmItems/catalog/runes.js — trilha E, fatia E13: as 35 RUNAS de engaste.
//
// `runa_<ataque|defesa|forca|inteligencia|destreza|velocidade|vitalidade>_<1…5>`: 7 chaves × 5 graus.
// Empilham (tb_mm_gear). Grau I e II caem nos Domínios (catalog/loot.js); os graus seguintes só pela
// fusão (3 de grau N → 1 de grau N+1; a linha do "onde conseguir" sai de index.sourcesOf). Valor e engaste: rules/runes.js.
"use strict";

const { G } = require("./_base");
const R = require("../rules/runes");

const KIND_NAME = Object.freeze({
  ataque: "Ataque", defesa: "Defesa", forca: "Acuracidade", inteligencia: "Inteligência",
  destreza: "Destreza", velocidade: "Velocidade", vitalidade: "Vitalidade",
});
const ROMAN = ["I", "II", "III", "IV", "V"];
const KEY_TEXT = Object.freeze({ dmg: "ataque", def: "defesa", acc: "acuracidade", int: "inteligência", dex: "destreza", spd: "velocidade", hp: "vida" });

const ITEMS = [];
const DESCRIPTIONS = {};
for (const kind of Object.keys(R.RUNE_KINDS)) {
  for (let g = 1; g <= R.GRADES; g++) {
    const id = R.runeId(kind, g);
    const key = R.RUNE_KINDS[kind];
    const pct = String(Math.round(R.runeValue(key, g) * 10000) / 100).replace(".", ",");
    ITEMS.push(G(id, "rune", `Runa de ${KIND_NAME[kind]} ${ROMAN[g - 1]}`, R.RARITY_OF_GRADE[g - 1], {
      stack: true, sell: 0, use: null, action: null,
      rune: Object.freeze({ kind, key, grade: g }),
      notes: Object.freeze([
        `Engastar numa peça com engaste livre: +${pct}% de ${KEY_TEXT[key]} (as runas somadas não passam de ${Math.round(R.runeValue(key, R.GRADES) * R.RUNE_DIVISOR * 10000) / 100}%).`,
        ...(g < R.GRADES ? [`Fundir ${R.FUSE_IN} numa runa de grau ${ROMAN[g]}.`] : []),
        "Tirar do engaste devolve a runa inteira para a mochila.",
      ]),
    }));
    DESCRIPTIONS[id] = `Pedra gravada com a marca de ${KIND_NAME[kind].toLowerCase()}. Encaixa em qualquer peça com engaste livre.`;
  }
}

module.exports = { ITEMS: Object.freeze(ITEMS), DESCRIPTIONS: Object.freeze(DESCRIPTIONS), KIND_NAME, ROMAN };
