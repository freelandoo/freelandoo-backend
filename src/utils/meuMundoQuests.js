// src/utils/meuMundoQuests.js — MEU MUNDO 3D, lore v2 F3: os 10 CAPÍTULOS.
//
// A história nova (MEU MUNDO 3D/historia/v2/03-capitulos.md): 10 capítulos
// encadeados, cada um abre por NÍVEL DO TREINADOR (a conta, mig 437). Todo mundo
// começa no capítulo 1 (decisão do Alex, 09/11): o prólogo antigo ("O Despertar
// de Lúmen", mm3d-59) não é mais lido.
//
// Cada passo tem UM objetivo que o SERVIDOR confere (MeuMundoQuestService.satisfied)
// — a interface nunca marca "feito" sozinha. Recompensa = recibo único
// ("<capítulo>:<passo>"): XP de aventura do personagem + o MESMO XP para o treinador.
//
// check = "<tipo>" ou "<tipo>:<argumento>"; `count` = quantas vezes (padrão 1).
//  ack                 leu e confirmou
//  clan                já escolheu a classe (Raposa/Vampiro)
//  ate                 comeu depois que o passo abriu
//  practice[:k]        começou treino/estudo (k = training | studying)
//  sleep               deitou para dormir em casa
//  buy:<tipo>          comprou item daquele tipo (food…)
//  weapon              tem a arma da classe (o passo entrega: grant "starter")
//  tutorialFight       terminou a luta de treino
//  armory              abriu o Armeiro e tem arma equipada
//  material            tem material na mochila
//  minigame            leu sobre os minijogos
//  forge               fez uma receita na Forja
//  game:<jogo>         terminou partida daquele jogo (boxe = luta no ringue)
//  games:N             N jogos DIFERENTES desde que o capítulo começou
//  fightWin[:<mob>]    venceu luta conferida (menos a de treino)
//  nightKill[:<mob>]   venceu monstro da rua (só aparecem de noite)
//  stat:N / power:N    algum atributo / o Poder do personagem ativo chegou a N
//  hallChallenge       desafiou alguém no Hall
//  mix                 fez uma mistura no Laboratório
//  certificate         abriu uma certidão (marca gravada pelo servidor)
//  visit:<lugar>       chegou ao lugar (a sala grava; F4, utils/meuMundoPlaces.js)
//  talk:<npc>          conversou com o NPC, no lugar dele (POST /quest/mark talk; F4)
//  archive:<id>        leu aquele texto do Arquivo (read_at; F5, utils/meuMundoArchive.js)
//  nectar:N            entregou N litros na estátua desde que o capítulo começou (N3; domingo)
//  — ainda sem dado (entram nas próximas fatias; até lá o passo fica pendente):
//  paintTop (C3)
"use strict";

const step = (key, check, xp, where, extra = {}) => Object.freeze({ key, check, xp, where, ...extra });

const CHAPTERS = Object.freeze([
  {
    id: "cap1",
    n: 1,
    minTrainerLevel: 1,
    steps: [
      step("degelo", "ack", 20, "laboratorio"),
      step("sol_ou_lua", "clan", 30, "laboratorio"),
      step("fome", "ate", 30, "comida"),
      step("praca", "visit:praca", 30, "centro"),
      step("pedra", "visit:estatua_morkhan", 50, "praca"),
      step("retorno", "talk:nivea", 60, "laboratorio"),
    ],
  },
  {
    id: "cap2",
    n: 2,
    minTrainerLevel: 3,
    steps: [
      step("portal", "visit:bairro", 30, "portal"),
      step("lar", "visit:casa", 30, "bairro"),
      step("despensa", "buy:food", 40, "supermercado"),
      step("geladeira", "ate", 30, "casa"),
      step("tregua", "talk:delegado", 40, "delegacia"),
      step("sonho", "sleep", 60, "casa"),
    ],
  },
  {
    id: "cap3",
    n: 3,
    minTrainerLevel: 5,
    steps: [
      step("jogos", "minigame", 40, "centro"),
      step("primeira", "games:1", 80, "minijogos"),
      step("tres", "games:3", 120, "minijogos"),
      step("oferenda", "nectar:1", 150, "estatua"),
      step("placar", "ack", 40, "placar"),
    ],
  },
  {
    id: "cap4",
    n: 4,
    minTrainerLevel: 8,
    steps: [
      step("corpo", "practice:training", 50, "academia"),
      step("mente", "practice:studying", 50, "universidade"),
      step("arma", "weapon", 40, "mochila", { grant: "starter" }),
      step("pedra", "tutorialFight", 60, "arena"),
      step("armeiro", "armory", 50, "arsenal"),
      step("forja", "forge", 70, "forja"),
      step("noite", "nightKill:wolf", 150, "rua_noite"),
    ],
  },
  {
    id: "cap5",
    n: 5,
    minTrainerLevel: 11,
    steps: [
      step("ninho", "archive:registro_ninho", 100, "ninho"),
      step("ilhas", "game:paint", 100, "paint"),
      step("bastor", "paintTop", 150, "paint"),
      step("matilha", "nightKill:wolf", 200, "rua_noite", { count: 3 }),
      step("numeros", "talk:nivea", 100, "laboratorio"),
    ],
  },
  {
    id: "cap6",
    n: 6,
    minTrainerLevel: 14,
    steps: [
      step("ecos", "fightWin", 150, "laminas", { count: 3 }),
      step("aco", "fightWin:ciborgue", 200, "laminas"),
      step("porta_azul", "talk:ciborgue", 100, "laminas"),
      step("fulvo", "talk:fulvo", 150, "bairro_vampiros"),
      step("forca", "stat:120", 150, "treino"),
    ],
  },
  {
    id: "cap7",
    n: 7,
    minTrainerLevel: 17,
    steps: [
      step("telhados", "fightWin:garras", 250, "laminas"),
      step("torre", "game:jetpack", 120, "jetpack"),
      step("caderno", "archive:caderno_aeryn", 120, "jetpack"),
      step("mistura", "mix", 150, "laboratorio"),
      step("certidao", "certificate", 60, "status"),
      step("material", "talk:nivea", 150, "laboratorio"),
    ],
  },
  {
    id: "cap8",
    n: 8,
    minTrainerLevel: 20,
    steps: [
      step("clareira", "visit:pedraverde", 120, "floresta_da_lua"),
      step("ringue", "game:boxe", 120, "boxe"),
      step("campeao", "fightWin:brute", 300, "boxe"),
      step("pipa", "talk:pipa", 100, "boxe"),
      step("muralha", "fightWin:stone", 300, "laminas"),
      step("peito", "visit:golem", 150, "pedraverde"),
    ],
  },
  {
    id: "cap9",
    n: 9,
    minTrainerLevel: 23,
    steps: [
      step("cadeiras", "hallChallenge", 150, "hall"),
      step("poder", "power:1500", 250, "status"),
      step("ouro", "fightWin:cavaleiro", 300, "laminas"),
      step("aldo", "talk:cavaleiro", 150, "estatua_aurion"),
      step("corrida", "nectar:30", 300, "estatua"),
    ],
  },
  {
    // o evento ao vivo do fim da temporada ficou para depois (roteiro, lv2-23):
    // o capítulo fecha na revelação de Zéphyra e na volta à cápsula
    id: "cap10",
    n: 10,
    minTrainerLevel: 27,
    steps: [
      step("lua", "game:noturno", 150, "noturno"),
      step("ceu", "game:corrida", 150, "corrida"),
      step("preco", "archive:zephyra_almas", 200, "corrida"),
      step("sombra", "nightKill:wolf", 400, "rua_noite"),
      step("memoria", "talk:nivea", 300, "laboratorio"),
    ],
  },
].map((ch, i, all) => Object.freeze({ ...ch, steps: Object.freeze(ch.steps), next: all[i + 1] ? all[i + 1].id : null })));

const CHAPTER_BY_ID = new Map(CHAPTERS.map((c) => [c.id, c]));

/** Checks que ainda não têm dado no servidor (o passo espera a fatia que grava). */
const PENDING_CHECKS = Object.freeze(["paintTop"]);

/** "fightWin:wolf" → { type: "fightWin", arg: "wolf" }. */
function parseCheck(check) {
  const s = String(check || "");
  const i = s.indexOf(":");
  return i < 0 ? { type: s, arg: null } : { type: s.slice(0, i), arg: s.slice(i + 1) };
}

/** Jogos que contam para game:/games: (corrida = Antigravidade; boxe = luta no ringue). */
const GAMES = Object.freeze(["jetpack", "noturno", "corrida", "paint", "gincana", "laminas", "boxe"]);

/** Marcas que o aparelho pode pedir para gravar (só o "abri" de uma tela; o servidor grava como evento). */
const MARKS = Object.freeze(["certificate", "talk"]);

const TOTAL_XP = CHAPTERS.reduce((a, c) => a + c.steps.reduce((b, s) => b + s.xp, 0), 0);

module.exports = { CHAPTERS, CHAPTER_BY_ID, PENDING_CHECKS, GAMES, MARKS, parseCheck, TOTAL_XP };
