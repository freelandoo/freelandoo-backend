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
 * O TOP 10 que a Arena mostra (2026-11-08, pedido do Alex: pódio do 1º ao 3º e lista do 4º
 * ao 10º, e dá para desafiar até o 1º com pouco Poder). Posição k = quem está na cadeira k;
 * cadeira vazia = o próximo do Poder que ainda não está sentado (`seated: false`) — vencer
 * esse dá a cadeira k. Sem ninguém = vaga (`user: null`).
 * `byPower` = ids em ordem de Poder (melhor primeiro).
 */
function topTen(seats, byPower) {
  const sitting = new Set(seats.values());
  const rest = byPower.filter((u) => !sitting.has(u));
  const out = [];
  for (let k = 1; k <= SEATS; k++) {
    if (seats.has(k)) out.push({ pos: k, user: seats.get(k), seated: true });
    else out.push({ pos: k, user: rest.shift() ?? null, seated: false });
  }
  return out;
}

/**
 * O Hall depois da vitória do desafiante. `seats` = Map(cadeira → id_user).
 * `target` = a cadeira vazia que o defensor de fora ocupava no top 10 (topTen).
 * `shown` = a posição em que o desafiante APARECIA no top 10 sem cadeira (pelo Poder).
 * Devolve { seats, seatWon } (seatWon = cadeira nova do desafiante; null = nada mudou).
 *
 * Regra do Alex (2026-11-08): VENCER NUNCA FAZ PERDER POSIÇÃO. Quem aparecia acima de
 * quem desafiou e vence fica onde estava — e, se aparecia só pelo Poder, a posição vira
 * cadeira dele (antes ele levava a cadeira do vencido, que podia ser pior).
 */
function afterWin(seats, challenger, defender, target = null, shown = null) {
  const out = new Map(seats);
  const seatOf = (u) => {
    for (const [k, v] of out) if (v === u) return k;
    return null;
  };
  const mine = seatOf(challenger);
  const theirs = seatOf(defender);
  // aparecia (sem cadeira) acima de quem venceu, ou o vencido nem está no top 10: garante a posição
  if (mine == null && shown != null && shown >= 1 && shown <= SEATS && !out.has(shown)) {
    const q = theirs ?? (target != null && target >= 1 && target <= SEATS && !out.has(target) ? target : null);
    if (q == null || shown < q) {
      out.set(shown, challenger);
      return { seats: out, seatWon: shown };
    }
  }
  if (theirs != null) {
    // já estou acima: venci, mas o Hall fica
    if (mine != null && mine < theirs) return { seats: out, seatWon: null };
    out.set(theirs, challenger);
    if (mine != null) out.set(mine, defender);
    return { seats: out, seatWon: theirs };
  }
  // defensor de fora do Hall mostrado numa cadeira vazia do top 10: fico com ela
  if (target != null && target >= 1 && target <= SEATS && !out.has(target)) {
    if (mine != null && mine < target) return { seats: out, seatWon: null };
    if (mine != null) out.delete(mine);
    out.set(target, challenger);
    return { seats: out, seatWon: target };
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

module.exports = { SEATS, LIMITS, PEER, peerOf, topTen, afterWin };
