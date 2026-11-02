// src/realtime/meuMundoPractice.js — MEU MUNDO 3D mm3d-59 (slice 4): o MEDIDOR de prática
// das salas dos minijogos.
//
// Quem mede é a SALA (o aparelho não diz quanto jogou). Conta só o tempo em
// que a pessoa está jogando de verdade:
//  • só durante a partida (a sala chama `pose` apenas na fase de jogo — fora
//    dela: espera, contagem, menu, resultado não contam);
//  • a pose tem que MUDAR (parado/AFK não conta; nos jogos que andam sozinhos
//    — Jetpack, Rolê — morrer para a pose e para a contagem);
//  • um buraco de mais de GAP_MS fecha o trecho (desconectou, pausou, morto).
// No fim (ou quando a pessoa sai no meio) `settle` entrega os trechos ao
// serviço, uma vez por pessoa por partida; o recibo volta pela sala principal
// (mensagem "receipt") para o aparelho celebrar. Tudo fora do laço da sala
// (assíncrono, erro só registrado) — a partida nunca espera o banco.

const GAP_MS = 2000;

class PracticeMeter {
  /** `activity` = id em meuMundoAdventure.js ACTIVITIES; `matchKey` = id único da partida. */
  constructor(activity, matchKey, log, gapMs = GAP_MS) {
    this.gapMs = gapMs;
    this.activity = activity;
    this.matchKey = matchKey;
    this.log = log;
    /** userId → { segs: [{from,to}], sig, settled } */
    this.users = new Map();
  }

  /** Uma pose aceita pela sala, durante a partida. */
  pose(userId, msg, now = Date.now()) {
    if (!userId) return;
    let u = this.users.get(userId);
    if (!u) this.users.set(userId, (u = { segs: [], sig: "", settled: false }));
    if (u.settled) return;
    const sig = signature(msg);
    if (sig === u.sig) return; // nada mudou: parado não conta
    u.sig = sig;
    const last = u.segs[u.segs.length - 1];
    if (last && now - last.to <= this.gapMs) last.to = now;
    else u.segs.push({ from: now, to: now });
  }

  /** Ms ativos medidos até agora (testes e logs). */
  activeMs(userId) {
    const u = this.users.get(userId);
    return u ? u.segs.reduce((a, g) => a + (g.to - g.from), 0) : 0;
  }

  /**
   * Entrega a prática de uma pessoa (ou de todas, sem `userId`). `wins` =
   * Set de quem venceu. Assíncrono e idempotente (recibo por partida+pessoa).
   */
  settle(userId = null, wins = null) {
    const ids = userId ? [userId] : [...this.users.keys()];
    for (const id of ids) {
      const u = this.users.get(id);
      if (!u || u.settled) continue;
      u.settled = true;
      if (!u.segs.some((g) => g.to > g.from)) continue;
      const Adv = require("../services/MeuMundoAdventureService");
      Adv.creditMinigame(id, { activity: this.activity, actionKey: `${this.matchKey}:${id}`, segments: u.segs, win: !!(wins && wins.has(id)) })
        .then((out) => {
          if (out && out.receipt && !out.replay) require("./meuMundoPresence").send(id, "receipt", out.receipt);
        })
        .catch((err) => this.log && this.log.warn("practice_credit_fail", { activity: this.activity, message: err.message }));
    }
  }
}

/** Assinatura curta da pose (só os números, arredondados: tremida de ponto flutuante não conta). */
function signature(msg) {
  if (!msg || typeof msg !== "object") return String(msg);
  const out = [];
  for (const k of Object.keys(msg).sort()) {
    const v = msg[k];
    if (typeof v === "number") out.push(Math.round(v * 20));
    else if (Array.isArray(v)) out.push(v.map((x) => (typeof x === "number" ? Math.round(x * 20) : x)).join(","));
    else if (typeof v !== "object") out.push(v);
  }
  return out.join("|");
}

module.exports = { PracticeMeter, GAP_MS, signature };
