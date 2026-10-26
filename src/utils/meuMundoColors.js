// src/utils/meuMundoColors.js — MEU MUNDO 3D: cores do personagem (mm3d-36, mig 304).
//
// Camiseta, calça, pele e cabelo do personagem padrão (nas 4 condições) e da
// feminina, escolhidos de uma PALETA. O que viaja é o código `look`: 4 dígitos
// base36 na ordem de PARTS (índice na paleta de cada parte). O cliente espelha
// a paleta em features/meu-mundo/avatar-colors.ts (teste de espelho).
// Sergio e Ekaterina têm visual próprio: look "" (sem pintar).

const PARTS = Object.freeze(["shirt", "pants", "skin", "hair"]);

const p = (list) => Object.freeze(list.map(([id, hex]) => Object.freeze({ id, hex })));
const PALETTE = Object.freeze({
  shirt: p([["red", "#C8202E"], ["white", "#F2F2EE"], ["black", "#26262A"], ["gray", "#8A8D93"], ["navy", "#1F2F5C"], ["sky", "#6FB7E8"], ["green", "#1E8A4A"], ["mint", "#8FD9B6"], ["yellow", "#F2C230"], ["orange", "#F07A28"], ["pink", "#F08DB4"], ["purple", "#7B4FC0"]]),
  pants: p([["jeans", "#2B3F73"], ["lightJeans", "#6F8FBF"], ["black", "#24262B"], ["gray", "#7C7F86"], ["beige", "#CDB894"], ["brown", "#6B4A30"], ["olive", "#5E6B3A"], ["wine", "#6E1F33"], ["white", "#EDEDE8"], ["royal", "#2F5BD3"]]),
  skin: p([["s0", "#FBE3D3"], ["s1", "#F3CFB3"], ["s2", "#E8B48F"], ["s3", "#D9A27A"], ["s4", "#C08660"], ["s5", "#A06A45"], ["s6", "#7A4D31"], ["s7", "#4E3020"]]),
  hair: p([["black", "#1E1A18"], ["darkBrown", "#3B2418"], ["brown", "#6B3A22"], ["red", "#A8341C"], ["copper", "#B5622B"], ["darkBlonde", "#9C7A45"], ["blonde", "#E0C27A"], ["gray", "#B9B6B0"], ["pink", "#F07AAE"], ["blue", "#3F7BE0"], ["purple", "#8A55D6"], ["green", "#3FAE6A"]]),
});

/** Camiseta vermelha, jeans, pele do meio, cabelo castanho: as cores de sempre. */
const DEFAULT_LOOK = "0032";

/** Skins que mudam de cor (Sergio e Ekaterina têm visual próprio). */
const COLORABLE_SKINS = Object.freeze(new Set(["standard", "feminina"]));
/** Corpos que a sala pinta (as 4 condições do padrão e a feminina). */
const COLORABLE_BODIES = Object.freeze(new Set(["normal", "slim", "fat", "strong", "female"]));

/** Código válido ou o padrão (nunca lança). */
function normalizeLook(code) {
  const s = String(code || "");
  if (!/^[0-9a-z]{4}$/.test(s)) return DEFAULT_LOOK;
  for (let i = 0; i < 4; i++) if (parseInt(s[i], 36) >= PALETTE[PARTS[i]].length) return DEFAULT_LOOK;
  return s;
}

/** Código da skin vestida a partir da coluna `colors` ("" = skin sem cores). */
function lookFor(colors, skin) {
  if (!COLORABLE_SKINS.has(skin)) return "";
  return normalizeLook(colors && colors[skin]);
}

/** O que a sala guarda para um corpo: o código (corpo colorível) ou "". */
const roomLook = (body, look) => (COLORABLE_BODIES.has(body) ? normalizeLook(look) : "");

module.exports = { PARTS, PALETTE, DEFAULT_LOOK, COLORABLE_SKINS, COLORABLE_BODIES, normalizeLook, lookFor, roomLook };
