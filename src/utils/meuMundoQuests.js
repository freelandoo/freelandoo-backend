// src/utils/meuMundoQuests.js — MEU MUNDO 3D mm3d-59 (slice 5): O DESPERTAR DE LÚMEN.
//
// Prólogo da reforma (lore aprovada em mm3d-48, "Os Jogos Eternos de Lúmen"):
// Morkhan, o Sem-Nome, interfere nas máquinas da cidade e as criaturas da
// noite são o sinal disso; Aurion orienta e protege; o jogador é quem age.
// Só personagens e lugares que já existem no jogo (Aurion e Morkhan são as
// estátuas; os prédios são os do centro).
//
// Cada passo tem UM objetivo que o SERVIDOR confere (MeuMundoQuestService) —
// a interface nunca marca "feito" sozinha. Recompensa de cada passo é um
// recibo único (`quest`, "<missão>:<passo>"). A soma de XP do prólogo (480)
// garante a primeira subida de nível (100) e a segunda (303) — ver
// meuMundoAdventure.js XP.
"use strict";

// check: o que o servidor confere para o passo valer.
//  ack           — a pessoa leu e confirmou (passos de apresentação)
//  ate           — comeu algo depois que o passo abriu (evento "consume")
//  practice      — começou treino OU estudo no prédio (evento "activity")
//  weapon        — tem a arma da classe (o passo entrega)
//  tutorialFight — terminou a luta de treino (recibo de luta "tutorial")
//  fightWin      — venceu uma luta conferida depois que o passo abriu
//  material      — tem algum material na mochila
//  armory        — abriu o Armeiro e tem uma arma equipada
//  minigame      — leu sobre os minijogos (até os minijogos mandarem recibo)
const PROLOGUE = Object.freeze({
  id: "despertar",
  steps: Object.freeze([
    { key: "chegada", check: "ack", xp: 20, where: "bairro" },
    { key: "recuperar", check: "ate", xp: 30, where: "casa" },
    { key: "treinar", check: "practice", xp: 40, where: "academia" },
    { key: "arma", check: "weapon", xp: 30, where: "mochila", grant: "starter" },
    { key: "aprender", check: "tutorialFight", xp: 50, where: "treino" },
    { key: "vitoria", check: "fightWin", xp: 80, where: "treino" },
    { key: "espolio", check: "material", xp: 40, where: "mochila" },
    { key: "armeiro", check: "armory", xp: 50, where: "armeiro" },
    { key: "jogos", check: "minigame", xp: 40, where: "centro" },
    { key: "pista", check: "ack", xp: 100, where: "estatua_morkhan", items: [["cristal_morkhan", 1], ["amuleto_aurion", 1]] },
  ]),
  /** A próxima missão (anunciada no fim; o conteúdo vem num slice seguinte). */
  next: "ecos_da_forja",
});

const QUESTS = Object.freeze({ [PROLOGUE.id]: PROLOGUE });
const TOTAL_XP = PROLOGUE.steps.reduce((a, s) => a + s.xp, 0);

module.exports = { PROLOGUE, QUESTS, TOTAL_XP };
