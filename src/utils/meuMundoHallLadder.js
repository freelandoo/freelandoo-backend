// src/utils/meuMundoHallLadder.js — B8 (2026-11-08): a regra pura das CADEIRAS do Hall.
// Sem banco: quem pode desafiar, a razão da ficha congelada e o que muda no Hall quando o
// desafiante vence. O serviço (MeuMundoHallService) só lê/grava.

const SEATS = 10;
const LIMITS = Object.freeze({ PER_DAY: 3, SAME_DEFENDER_H: 24, TOP_POWER: 100 });
const PEER = Object.freeze({ MIN: 0.5, MAX: 2 });

/** Razão da ficha congelada (Poder do defensor ÷ o meu), no intervalo que a luta aceita. */
function peerOf(challengerPower, defenderPower) {
  const c = Math.max(1, Number(challengerPower) || 0);
  const d = Math.max(1, Number(defenderPower) || 0);
  return Math.round(Math.min(PEER.MAX, Math.max(PEER.MIN, d / c)) * 10000) / 10000;
}

/**
 * O Hall depois da vitória do desafiante. `seats` = Map(cadeira → id_user).
 * Devolve { seats, seatWon } (seatWon = cadeira nova do desafiante; null = nada mudou).
 */
function afterWin(seats, challenger, defender) {
  const out = new Map(seats);
  const seatOf = (u) => {
    for (const [k, v] of out) if (v === u) return k;
    return null;
  };
  const mine = seatOf(challenger);
  const theirs = seatOf(defender);
  if (theirs != null) {
    // já estou acima: venci, mas o Hall fica
    if (mine != null && mine < theirs) return { seats: out, seatWon: null };
    out.set(theirs, challenger);
    if (mine != null) out.set(mine, defender);
    return { seats: out, seatWon: theirs };
  }
  // defensor de fora do Hall (top do Poder): senta na primeira cadeira vazia
  if (mine != null) return { seats: out, seatWon: null };
  for (let k = 1; k <= SEATS; k++) {
    if (!out.has(k)) {
      out.set(k, challenger);
      return { seats: out, seatWon: k };
    }
  }
  return { seats: out, seatWon: null };
}

module.exports = { SEATS, LIMITS, PEER, peerOf, afterWin };
