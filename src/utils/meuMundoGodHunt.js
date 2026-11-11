// src/utils/meuMundoGodHunt.js — MEU MUNDO 3D, lore v2 N4: O DEUS SOLTO.
//
// Estátua cheia no domingo (N3, `full_at` de tb_mm_statue_week) → na semana
// seguinte (a partir da segunda 00:00 de Brasília, quando o domingo acaba) o
// deus DAQUELE povo anda pela rua e pelos Domínios caçando a raça OPOSTA:
//   Raposas encheram Aurion → Aurion caça Vampiros
//   Vampiros encheram Morkhan → Morkhan caça Raposas
// Mais rápido que os monstros (e que a corrida do jogador: não dá para fugir).
// Alcançou = luta um contra um (a das Lâminas, re-simulada) com o deus em 2× o
// status de quem enfrenta (decisão D1; regra em laminas/sim → GOD_PEER). Perder
// só tira energia (sem estresse, sem status). Fica solto até alguém vencê-lo:
// a primeira vitória conferida encerra para TODOS (tb_mm_god_hunt, mig 447).
"use strict";

const St = require("./meuMundoStatue");
const FightSim = require("./meuMundoFight");

/** O deus de cada povo, a presa dele e os golpes (o tipo da luta: GOD_KINDS da regra). */
const GODS = Object.freeze({
  aurion: Object.freeze({ id: "aurion", clan: "raposa", prey: "vampiro", kind: FightSim.GOD_KINDS.aurion }),
  morkhan: Object.freeze({ id: "morkhan", clan: "vampiro", prey: "raposa", kind: FightSim.GOD_KINDS.morkhan }),
});
const GOD_IDS = Object.freeze(Object.keys(GODS));
const godOf = (id) => GODS[String(id || "")] || null;
const godOfClan = (clan) => GOD_IDS.map((k) => GODS[k]).find((g) => g.clan === clan) || null;

/** Quando o deus do domingo `week` solta: o fim do domingo (segunda 00:00 de Brasília). */
const looseAtFor = (week) => St.sundayEndsAt(week);

/** Como o deus anda na rua (a sala; MobDirector em modo deus). */
const HUNT = Object.freeze({
  /** Caminhando entre pontos da sala. */
  WALK_V: 1.6,
  /** Caçando: a corrida do jogador é 3,5 e a dos monstros 3,2 — o deus é mais rápido. */
  CHASE_V: 4.4,
  /** Sente a presa em volta (sem cone): caça mesmo. */
  SIGHT: 26,
  /** Desiste (perdeu de vista). */
  LOSE: 40,
  /** Alcançou. */
  CATCH: 2,
  RADIUS: 1.6,
  /** Quem perdeu para ele fica em paz por este tempo. */
  CALM_MS: 90_000,
  /** Ocupado (minijogo, tela por cima) = paz mais curta. */
  BUSY_MS: 60_000,
  /** Luta sem resposta do aparelho: ele volta a andar. */
  FIGHT_MS: 300_000,
  /** Nasce longe de quem está na sala. */
  FAR_FROM_PLAYER: 14,
  /** Vitória vale para quem luta com ele ou está perto (como os monstros). */
  CLAIM_REACH: 25,
  /** Domínio (cena do aparelho): aparece a esta distância atrás e começa a caçar depois de... */
  DOMAIN_BEHIND: 30,
  DOMAIN_DELAY_MS: 20_000,
});

/** Essa pessoa é presa deste deus? (povo da CONTA) */
const isPrey = (god, clan) => {
  const g = godOf(god);
  return !!g && !!clan && g.prey === clan;
};

/** O deus aparece nesta sala? Bairro de um povo só recebe o deus que caça esse povo; o centro recebe os dois. */
const showsIn = (god, roomClan) => {
  const g = godOf(god);
  if (!g) return false;
  return !roomClan || g.prey === roomClan;
};

module.exports = { GODS, GOD_IDS, HUNT, godOf, godOfClan, looseAtFor, isPrey, showsIn, GOD_PEER: FightSim.GOD_PEER };
