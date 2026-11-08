// src/utils/meuMundoSpecies.js — B3 (2026-11-08): o corpo e a altura de um PERSONAGEM.
//
// A regra das espécies mora em meuMundoCharacters.js (GERADO do front). Aqui só a ponte
// com o que o servidor já tinha: o personagem sem espécie (quem ainda não escolheu a
// classe) segue a classe do jogador e, sem classe, a condição física (magro/normal/…).
// Substitui o avatarBody das skins (o vestuário saiu do jogo no B3).

const Chars = require("./meuMundoCharacters");
const { clanBody, isClan } = require("./meuMundoClans");

/** Espécie que vale: a do personagem; sem ela, a classe do jogador (ou null). */
const speciesOf = (species, clan) => (Chars.speciesById(species) ? species : isClan(clan) ? clan : null);

/**
 * Corpo que a sala desenha para o personagem ativo.
 *  { species, sex } do personagem, `stage` (young|adult) da vida, { clan, clanSex } do
 *  jogador e `condition` (corpo da condição física) para quem não tem nem uma nem outra.
 */
function characterBody({ species = null, sex = null, stage = null, clan = null, clanSex = null, condition = null } = {}) {
  const sp = speciesOf(species, clan);
  const b = Chars.speciesBody(sp, sex || clanSex, stage);
  if (b) return b;
  return clanBody(clan, clanSex, stage) || condition || "normal";
}

/** Altura de agora (m) pela espécie e pelo crescimento da vida (ver rules.ts speciesHeight). */
function characterHeight({ species = null, sex = null, clan = null, clanSex = null, growth = null } = {}, t = Date.now()) {
  const sp = speciesOf(species, clan);
  if (!sp) return 1.8;
  return Chars.speciesHeight(sp, sex || clanSex, growth, t);
}

module.exports = { speciesOf, characterBody, characterHeight };
